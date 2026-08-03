// Módulo DIRECCIONAL de cierre (opuesto a vender prima): en las últimas ~2h, cuando la gamma
// es NEGATIVA (los dealers amplifican el move) y entra flujo institucional agresivo direccional,
// el precio suele CORRER hacia el muro/imán. Este es el cerebro que cruza GEX + flujo + tiempo
// y da una señal direccional con target. PURO y testeable.
// Ver docs/superpowers/specs/2026-08-03-spx-momentum-cierre-design.md

/** Minutos hasta el cierre RTH (16:00 ET) y día de semana, desde una fecha. null si fin de semana. */
export function minutesToClose(now: Date): number | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (["Sat", "Sun"].includes(wd)) return null;
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return 16 * 60 - (hh * 60 + mm); // minutos hasta las 16:00 ET
}

export interface AggressiveFlow {
  aggBullPremium: number; // Aggr.Buy calls + Aggr.Sell puts (reciente)
  aggBearPremium: number; // Aggr.Buy puts + Aggr.Sell calls
  count: number;
}

/**
 * Flujo AGRESIVO direccional reciente (prints ABOVE_ASK = compra agresiva, BELOW_BID = venta
 * agresiva) — el "surge" que anticipa el move. Solo la ventana reciente (default 30 min).
 * Compra agresiva de calls / venta agresiva de puts = alcista; y al revés = bajista.
 */
export function aggressiveFlow(
  trades: { type: "call" | "put"; rawSide: string; premium: number; timestamp: string }[],
  now: Date,
  windowMin = 30,
): AggressiveFlow {
  const cutoff = now.getTime() - windowMin * 60_000;
  let bull = 0;
  let bear = 0;
  let count = 0;
  for (const t of trades) {
    const ts = Date.parse(t.timestamp);
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const s = t.rawSide.toUpperCase();
    const aggBuy = s === "ABOVE_ASK";
    const aggSell = s === "BELOW_BID";
    if (!aggBuy && !aggSell) continue;
    count += 1;
    if (aggBuy) {
      if (t.type === "call") bull += t.premium;
      else bear += t.premium;
    } else {
      if (t.type === "put") bull += t.premium; // venta agresiva de put = alcista (soporte)
      else bear += t.premium; // venta agresiva de call = bajista (resistencia)
    }
  }
  return { aggBullPremium: bull, aggBearPremium: bear, count };
}

export type MomentumBias = "long" | "short" | "none";
export type MomentumSetup = "momentum" | "breakout" | "none";

export interface ClosingMomentumInput {
  now: Date;
  spot: number;
  netGex: number | null; // GEX neto total (− = amplifica, + = pinnea)
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  magnet: number | null;
  aggBullPremium: number; // $ agresivo alcista reciente (Aggr.Buy calls + Aggr.Sell puts)
  aggBearPremium: number; // $ agresivo bajista reciente (Aggr.Buy puts + Aggr.Sell calls)
  windowMin?: number; // ventana de cierre (default 120 = 2h)
  flowThreshold?: number; // % neto mínimo para dar dirección (default 20)
}

export interface ClosingMomentumSignal {
  active: boolean; // dentro de la ventana de cierre
  minutesToClose: number | null;
  regime: "negative" | "positive";
  setup: MomentumSetup;
  bias: MomentumBias;
  target: number | null; // muro/imán hacia donde iría el move
  targetPts: number | null; // distancia al target
  flowNetPct: number; // −100..100 (+ = alcista)
  conviction: number; // 0-100
  headline: string;
  reasons: string[];
}

/**
 * Señal direccional de cierre. Setup "momentum" = gamma negativa (amplifica) + flujo agresivo
 * de un lado → corre al muro en esa dirección. Setup "breakout" = gamma positiva pero el precio
 * rompe un muro con flujo agresivo → corre al siguiente nivel. Convicción por régimen + fuerza
 * del flujo + que exista target.
 */
export function closingMomentumSignal(input: ClosingMomentumInput): ClosingMomentumSignal {
  const windowMin = input.windowMin ?? 120;
  const threshold = input.flowThreshold ?? 20;
  const mtc = minutesToClose(input.now);
  const active = mtc != null && mtc > 0 && mtc <= windowMin;

  const regime: "negative" | "positive" =
    input.netGex != null && input.netGex < 0 ? "negative" : "positive";

  const total = input.aggBullPremium + input.aggBearPremium;
  const flowNetPct = total > 0 ? ((input.aggBullPremium - input.aggBearPremium) / total) * 100 : 0;
  const flowBias: MomentumBias =
    flowNetPct > threshold ? "long" : flowNetPct < -threshold ? "short" : "none";

  const above = (lvl: number | null): number | null => (lvl != null && lvl > input.spot ? lvl : null);
  const below = (lvl: number | null): number | null => (lvl != null && lvl < input.spot ? lvl : null);

  let setup: MomentumSetup = "none";
  let bias: MomentumBias = "none";
  let target: number | null = null;

  if (active && flowBias !== "none") {
    if (regime === "negative") {
      // Gamma negativa: el move se amplifica en la dirección del flujo.
      setup = "momentum";
      bias = flowBias;
      target = bias === "long" ? (above(input.callWall) ?? above(input.magnet)) : (below(input.putWall) ?? below(input.magnet));
    } else {
      // Gamma positiva: solo si el precio ROMPE el muro relevante con el flujo (breakout).
      const breakingUp = flowBias === "long" && input.callWall != null && input.spot >= input.callWall - 2;
      const breakingDown = flowBias === "short" && input.putWall != null && input.spot <= input.putWall + 2;
      if (breakingUp) {
        setup = "breakout";
        bias = "long";
        target = above(input.magnet) ?? (input.callWall != null ? input.callWall + 15 : null);
      } else if (breakingDown) {
        setup = "breakout";
        bias = "short";
        target = below(input.magnet) ?? (input.putWall != null ? input.putWall - 15 : null);
      }
    }
  }

  const targetPts = target != null ? Math.round(Math.abs(target - input.spot)) : null;

  let conviction = 0;
  if (setup === "momentum") conviction += 35;
  else if (setup === "breakout") conviction += 20;
  conviction += Math.min(Math.abs(flowNetPct), 60) * 0.6;
  if (target != null && targetPts != null && targetPts > 0) conviction += 15;
  conviction = Math.min(100, Math.round(conviction));

  const reasons: string[] = [];
  reasons.push(`gamma ${regime === "negative" ? "NEGATIVA (amplifica moves)" : "positiva (pinnea)"}`);
  reasons.push(`flujo agresivo ${flowBias === "long" ? "ALCISTA" : flowBias === "short" ? "BAJISTA" : "mixto"} (${flowNetPct >= 0 ? "+" : ""}${Math.round(flowNetPct)}%)`);
  if (input.gammaFlip != null) reasons.push(`flip ${input.gammaFlip.toFixed(0)} (spot ${input.spot > input.gammaFlip ? "arriba" : "abajo"})`);
  if (target != null) reasons.push(`target ${target} (${targetPts} pts)`);
  if (mtc != null) reasons.push(`${mtc} min al cierre`);

  let headline: string;
  if (!active) headline = "Fuera de la ventana de cierre (últimas 2h).";
  else if (setup === "momentum" && bias === "long") headline = `🚀 Momentum ALCISTA de cierre → target ${target ?? "?"}`;
  else if (setup === "momentum" && bias === "short") headline = `🔻 Momentum BAJISTA de cierre → target ${target ?? "?"}`;
  else if (setup === "breakout" && bias === "long") headline = `📈 Breakout ALCISTA (rompe el muro) → target ${target ?? "?"}`;
  else if (setup === "breakout" && bias === "short") headline = `📉 Breakout BAJISTA (rompe el muro) → target ${target ?? "?"}`;
  else headline = "⏳ En ventana de cierre, sin setup direccional claro (gamma pinnea o flujo mixto).";

  return {
    active,
    minutesToClose: mtc,
    regime,
    setup,
    bias,
    target,
    targetPts,
    flowNetPct: Math.round(flowNetPct),
    conviction,
    headline,
    reasons,
  };
}
