// SPX 0DTE/1DTE — lógica pura del data layer. Deriva el spot (sin plan de Indices) y
// separa la cadena por DTE. Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { marketDateStr, parseOcc } from "./occ";
import { aggressionOf, type RawTrade } from "./flow";
import { buildSpread, type OptionQuote, type LevelLite, type Spread } from "./premiumSell";

export interface SpxQuote {
  strike: number;
  type: "call" | "put";
  expiration: string; // YYYY-MM-DD
  price: number; // último/cierre, por acción
  delta: number | null;
  gamma: number | null;
  iv: number | null; // decimal
  oi: number;
}

/**
 * Deriva el spot de SPX por **paridad put-call** (el índice da 403 en este plan):
 * para un strike con call y put, spot ≈ K + C − P (r≈0 razonable en 0DTE/1DTE).
 * Toma la **mediana** de las estimaciones de los strikes con ambas patas → robusto a
 * un strike mal-priceado.
 */
export function deriveSpxSpot(quotes: SpxQuote[]): number | null {
  const byStrike = new Map<number, { c?: number; p?: number }>();
  for (const q of quotes) {
    if (!(q.price > 0)) continue;
    const e = byStrike.get(q.strike) ?? {};
    if (q.type === "call") e.c = q.price;
    else e.p = q.price;
    byStrike.set(q.strike, e);
  }
  const spots: number[] = [];
  for (const [k, { c, p }] of byStrike) {
    if (c != null && p != null) spots.push(k + c - p);
  }
  if (spots.length === 0) return null;
  spots.sort((a, b) => a - b);
  return spots[Math.floor(spots.length / 2)]; // mediana
}

export interface SpxGexNode {
  strike: number;
  netGex: number; // callGex − putGex (signo = lado dominante)
  callGex: number;
  putGex: number;
}

export interface SpxGex {
  nodes: SpxGexNode[]; // cerca del spot, ordenados por |netGex| desc
  callWall: number | null; // resistencia gamma (mayor GEX de calls sobre el spot)
  putWall: number | null; // soporte gamma (mayor GEX de puts bajo el spot)
  magnet: number | null; // imán (mayor |netGex|)
  flip: number | null; // zona de inversión gamma (net GEX acumulado cruza 0)
  regime: "positive" | "negative"; // gamma neta total (positive = pinnea, negative = amplifica)
  totalNetGex: number;
}

/**
 * GEX del 0DTE/1DTE usando la **gamma REAL** de la cadena (Massive la trae por contrato,
 * no hay que estimarla). GEX por strike = gamma × OI × 100 × spot² × 0.01, +call −put.
 * Deriva muros (resistencia/soporte gamma), imán, flip y régimen. Los MUROS son las colas
 * más seguras para vender prima: el precio rara vez las cruza porque el dealer hedgea ahí.
 */
export function spxGex(quotes: SpxQuote[], spot: number): SpxGex {
  const empty: SpxGex = {
    nodes: [],
    callWall: null,
    putWall: null,
    magnet: null,
    flip: null,
    regime: "positive",
    totalNetGex: 0,
  };
  if (!(spot > 0)) return empty;

  const F = 100 * spot * spot * 0.01;
  const byStrike = new Map<number, { call: number; put: number }>();
  for (const q of quotes) {
    if (q.gamma == null || q.gamma <= 0 || q.oi <= 0) continue;
    const mag = q.gamma * q.oi * F;
    const e = byStrike.get(q.strike) ?? { call: 0, put: 0 };
    if (q.type === "call") e.call += mag;
    else e.put += mag;
    byStrike.set(q.strike, e);
  }
  const all: SpxGexNode[] = [...byStrike.entries()]
    .map(([strike, { call, put }]) => ({ strike, callGex: call, putGex: put, netGex: call - put }))
    .sort((a, b) => a.strike - b.strike);
  if (all.length === 0) return empty;

  const totalNetGex = all.reduce((s, n) => s + n.netGex, 0);
  const magnet = all.reduce((a, b) => (Math.abs(b.netGex) > Math.abs(a.netGex) ? b : a)).strike;

  const above = all.filter((n) => n.strike > spot);
  const below = all.filter((n) => n.strike < spot);
  const callWall = above.length
    ? above.reduce((a, b) => (b.callGex > a.callGex ? b : a)).strike
    : null;
  const putWall = below.length
    ? below.reduce((a, b) => (b.putGex > a.putGex ? b : a)).strike
    : null;

  // Flip = strike donde el GEX neto acumulado (de abajo hacia arriba) cruza de − a +.
  let cum = 0;
  let flip: number | null = null;
  for (const n of all) {
    const prev = cum;
    cum += n.netGex;
    if (prev < 0 && cum >= 0) {
      flip = n.strike;
      break;
    }
  }

  const near = all
    .filter((n) => Math.abs(n.strike - spot) / spot <= 0.03)
    .sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex));

  return {
    nodes: near,
    callWall,
    putWall,
    magnet,
    flip,
    regime: totalNetGex >= 0 ? "positive" : "negative",
    totalNetGex,
  };
}

export interface SpxFlowTrade {
  strike: number;
  type: "call" | "put";
  expiration: string; // YYYY-MM-DD
  side: "ask" | "bid" | "mid" | "unknown"; // agresividad: ask = comprado, bid = vendido
  premium: number;
  gamma: number | null;
  delta: number | null;
  iv: number | null;
}

/**
 * Parsea el flujo SPX de MarketSnack: filtra a contratos SPX/SPXW, saca strike/tipo/vto del
 * símbolo OCC y clasifica la agresividad (ask = comprado, bid = vendido). Ignora lo que no
 * parsea (otros subyacentes que se cuelen, símbolos raros).
 */
export function parseSpxFlow(raw: RawTrade[]): SpxFlowTrade[] {
  const out: SpxFlowTrade[] = [];
  for (const t of raw) {
    const occ = parseOcc(t.symbol);
    if (!occ) continue;
    const root = occ.underlying.toUpperCase();
    if (root !== "SPX" && root !== "SPXW") continue;
    out.push({
      strike: occ.strike,
      type: occ.type,
      expiration: occ.expiration,
      side: aggressionOf(t.side),
      premium: t.premium ?? 0,
      gamma: t.gamma ?? null,
      delta: t.delta ?? null,
      iv: t.implied_volatility ?? null,
    });
  }
  return out;
}

export interface SpxFlowBias {
  bullishPremium: number; // calls compradas al ask + puts vendidas al bid
  bearishPremium: number; // puts compradas al ask + calls vendidas al bid
  netPct: number; // −100..100 (+ = alcista)
  lean: "bullish" | "bearish" | "neutral";
  sellSide: "put" | "call" | "either"; // qué lado vender: alcista → put spread; bajista → call spread
}

/**
 * Sesgo del flujo AGRESIVO para decidir qué lado vender. Compras al ask (agresivas) mandan;
 * las ventas al bid del lado contrario también apuntan en la misma dirección. Alcista →
 * el riesgo es al alza → vender el **put spread** (más seguro abajo). Bajista → **call spread**.
 */
export function flowBias(trades: SpxFlowTrade[]): SpxFlowBias {
  let bull = 0;
  let bear = 0;
  for (const t of trades) {
    const p = t.premium;
    if (t.side === "ask") {
      if (t.type === "call") bull += p;
      else bear += p;
    } else if (t.side === "bid") {
      if (t.type === "put") bull += p; // put vendida = soporte, alcista
      else bear += p; // call vendida = resistencia, bajista
    }
  }
  const total = bull + bear;
  const netPct = total > 0 ? ((bull - bear) / total) * 100 : 0;
  const lean = netPct > 15 ? "bullish" : netPct < -15 ? "bearish" : "neutral";
  const sellSide = lean === "bullish" ? "put" : lean === "bearish" ? "call" : "either";
  return { bullishPremium: bull, bearishPremium: bear, netPct, lean, sellSide };
}

/**
 * IV ATM de SPX: strike más cercano al spot, tomando el **mínimo** de call/put IV (robusto a
 * una pata con IV basura, como en earnings). Devuelve decimal (0.12 = 12%).
 */
export function atmIvSpx(quotes: SpxQuote[], spot: number): number | null {
  if (!(spot > 0)) return null;
  const strikes = [...new Set(quotes.map((q) => q.strike))];
  if (strikes.length === 0) return null;
  const k = strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a));
  const ivs = quotes
    .filter((q) => q.strike === k && q.iv != null && q.iv > 0)
    .map((q) => q.iv as number);
  return ivs.length ? Math.min(...ivs) : null;
}

/** Move diario 1σ en % desde la IV anualizada: IV·√(1/365)·100. */
export function spxDailySigmaPct(iv: number): number {
  return iv * Math.sqrt(1 / 365) * 100;
}

export interface SpxExtreme {
  side: "put" | "call";
  spread: Spread; // reusa premiumSell.Spread (crédito/máx-pérdida/BE/R-R/ProbOTM)
  anchor: "wall" | "sigma" | "delta" | "credit"; // qué restricción mandó al elegir el short
  shortDelta: number | null; // |delta| del short (lo que el usuario verifica al vender por prima)
  wall: number | null; // muro de GEX de referencia de ese lado
  breakevenWinPct: number; // % de aciertos que necesita para EV=0 (asume máx pérdida siempre = pesimista)
  evMargin: number; // ProbOTM − breakevenWinPct (puntos). >0 no-negativo; −1 es al filo, −20 es malo
  evOk: boolean; // evMargin ≥ 0
  recommended: boolean; // el lado que sugiere el flujo agresivo
}

export interface SpxSafeSetup {
  spot: number;
  expiration: string | null;
  atmIv: number | null; // decimal
  sigma1Pct: number; // move diario 1σ en %
  gex: SpxGex;
  bias: SpxFlowBias;
  extremes: SpxExtreme[]; // put y/o call, con el flag recommended
}

/**
 * Elige el short strike **anclado al muro de GEX** (donde el dealer defiende el precio): el
 * primer strike justo fuera del muro. Si ahí el |delta| supera el tope (demasiado cerca/arriesgado),
 * lo empuja hacia afuera hasta cumplir el tope. Si no hay muro, cae a N·σ. Este anclaje da
 * crédito real y defendido — mucho mejor EV que "lo más externo posible". `anchor` = qué mandó.
 *
 * Aprendizaje en vivo (2026-07-30): anclar al más-externo-entre-muro+σ+delta daba spreads
 * 94% OTM pero EV-negativo (cobraban migajas). El muro es la cola defendible correcta.
 */
function pickSafeShort(
  sideQuotes: SpxQuote[],
  side: "put" | "call",
  spot: number,
  wall: number | null,
  sigmaAbs: number,
  maxDelta: number,
): { strike: number; anchor: "wall" | "sigma" | "delta" } | null {
  const isPut = side === "put";
  const otm = sideQuotes
    .filter((q) => q.delta != null && (isPut ? q.strike < spot : q.strike > spot))
    .sort((a, b) => (isPut ? b.strike - a.strike : a.strike - b.strike)); // del menos al más externo
  if (otm.length === 0) return null;

  // Ancla base: el muro (primer strike fuera del muro); si no hay muro, N·σ.
  const sigmaStrike = isPut ? spot - sigmaAbs : spot + sigmaAbs;
  const base = wall ?? sigmaStrike;
  let anchor: "wall" | "sigma" | "delta" = wall != null ? "wall" : "sigma";

  // Empezar en el primer strike al-menos-tan-externo como el ancla base.
  let idx = otm.findIndex((q) => (isPut ? q.strike <= base : q.strike >= base));
  if (idx === -1) idx = otm.length - 1; // el ancla queda fuera de la cadena → el más externo

  // Empujar hacia afuera mientras el |delta| supere el tope (demasiado arriesgado en el muro).
  while (idx < otm.length - 1 && Math.abs(otm[idx].delta as number) > maxDelta) {
    idx += 1;
    anchor = "delta";
  }
  return { strike: otm[idx].strike, anchor };
}

/**
 * Modo "prima objetivo" (como opera el usuario): entre los spreads de `width` puntos, elige el
 * que cae en la banda de crédito [min, max] y queda **más cerca del muro de GEX** (el más
 * defendible). Sin muro, toma el más externo de la banda. Devuelve el short + de qué banda salió.
 */
function pickByCredit(
  sideQuotes: SpxQuote[],
  side: "put" | "call",
  spot: number,
  wall: number | null,
  width: number,
  creditMin: number,
  creditMax: number,
): { strike: number; anchor: "wall" | "credit" } | null {
  const isPut = side === "put";
  const byK = new Map<number, number>(); // strike → precio
  for (const q of sideQuotes) byK.set(q.strike, q.price);
  const strikes = [...byK.keys()]
    .filter((k) => (isPut ? k < spot : k > spot))
    .sort((a, b) => (isPut ? b - a : a - b)); // del menos al más externo

  const inBand: number[] = [];
  for (const k of strikes) {
    const short = byK.get(k);
    const long = byK.get(isPut ? k - width : k + width);
    if (short == null || long == null) continue;
    const credit = short - long;
    if (credit >= creditMin && credit <= creditMax) inBand.push(k);
  }
  if (inBand.length === 0) return null;

  if (wall != null) {
    const chosen = inBand.reduce((a, b) => (Math.abs(b - wall) < Math.abs(a - wall) ? b : a));
    return { strike: chosen, anchor: Math.abs(chosen - wall) / wall <= 0.01 ? "wall" : "credit" };
  }
  return { strike: inBand[inBand.length - 1], anchor: "credit" }; // el más externo de la banda
}

/**
 * Extremos safe para vender prima en 0DTE/1DTE. Ancla el short a los **muros de GEX** (donde
 * el dealer pinnea) además de σ y delta, arma el credit spread (reusa `buildSpread`), aplica
 * el **filtro de EV** (win% para breakeven vs ProbOTM) y marca el lado que sugiere el flujo.
 * Con `opts.credit` cambia al **modo prima objetivo**: elige por banda de crédito (como opera
 * el usuario) en vez de por delta. `quotes` = un solo DTE.
 * Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md
 */
export function spxSafeExtremes(
  quotes: SpxQuote[],
  spot: number,
  gex: SpxGex,
  bias: SpxFlowBias,
  opts: {
    maxDelta?: number;
    sigmaMult?: number;
    width?: number;
    credit?: { min: number; max: number }; // modo prima objetivo (crédito por acción)
  } = {},
): SpxSafeSetup {
  const maxDelta = opts.maxDelta ?? 0.25; // tope de |delta| del short (no vender más cerca)
  const sigmaMult = opts.sigmaMult ?? 1;
  const width = opts.width ?? 5;
  const iv = atmIvSpx(quotes, spot);
  const sigma1Pct = iv != null ? spxDailySigmaPct(iv) : 0;
  const sigmaAbs = (sigma1Pct / 100) * spot * sigmaMult;
  const expiration = quotes[0]?.expiration ?? null;

  const oq: OptionQuote[] = quotes
    .filter((q) => q.delta != null)
    .map((q) => ({ strike: q.strike, type: q.type, price: q.price, delta: q.delta as number, oi: q.oi }));
  const walls: LevelLite[] = [gex.putWall, gex.callWall, gex.magnet]
    .filter((x): x is number => x != null)
    .map((price) => ({ price, strength: 100 }));

  const extremes: SpxExtreme[] = [];
  for (const side of ["put", "call"] as const) {
    const sideQuotes = quotes.filter((q) => q.type === side);
    const wall = side === "put" ? gex.putWall : gex.callWall;
    const pick = opts.credit
      ? pickByCredit(sideQuotes, side, spot, wall, width, opts.credit.min, opts.credit.max)
      : pickSafeShort(sideQuotes, side, spot, wall, sigmaAbs, maxDelta);
    if (!pick) continue;
    const spread = buildSpread(side === "put" ? "bull_put" : "bear_call", oq, pick.strike, width, walls);
    if (!spread) continue;
    const shortDelta = sideQuotes.find((q) => q.strike === pick.strike)?.delta ?? null;
    const risk = spread.maxLoss;
    const reward = spread.credit * 100;
    const breakevenWinPct = risk + reward > 0 ? Math.round((risk / (risk + reward)) * 100) : 100;
    const evMargin = spread.probOTM - breakevenWinPct;
    extremes.push({
      side,
      spread,
      anchor: pick.anchor,
      shortDelta: shortDelta != null ? Math.abs(shortDelta) : null,
      wall,
      breakevenWinPct,
      evMargin,
      evOk: evMargin >= 0,
      recommended: bias.sellSide === side || bias.sellSide === "either",
    });
  }
  return { spot, expiration, atmIv: iv, sigma1Pct, gex, bias, extremes };
}

/**
 * Separa la cadena en 0DTE (vence hoy, día de mercado ET) y 1DTE (el próximo vencimiento
 * disponible). Robusto a fines de semana: 1DTE = el siguiente vencimiento, no "hoy+1".
 */
export function splitByDte(
  quotes: SpxQuote[],
  now: Date,
): { zeroDte: SpxQuote[]; oneDte: SpxQuote[]; zeroExp: string | null; oneExp: string | null } {
  const today = marketDateStr(now);
  const exps = [...new Set(quotes.map((q) => q.expiration))].filter((e) => e >= today).sort();
  const zeroExp = exps.includes(today) ? today : null;
  const oneExp = exps.find((e) => e > today) ?? null;
  return {
    zeroDte: zeroExp ? quotes.filter((q) => q.expiration === zeroExp) : [],
    oneDte: oneExp ? quotes.filter((q) => q.expiration === oneExp) : [],
    zeroExp,
    oneExp,
  };
}
