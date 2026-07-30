// Monitor en vivo de una posición de venta de prima: evalúa si el panorama se volvió en contra
// (flujo agresivo opuesto, precio acercándose al short, muro que ya no defiende) y recomienda
// AGUANTAR / VIGILAR / CERRAR / SALIR. PURO y testeable.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

export type MonitorAction = "hold" | "take_profit" | "watch" | "exit";

export interface MonitorPosition {
  kind: "bull_put" | "bear_call";
  shortStrike: number;
  longStrike: number;
  credit: number; // por acción, al entrar
  expiration: string;
}

export interface PositionMarket {
  spot: number;
  shortDelta: number | null; // |delta| del short ahora
  shortMark: number | null; // precio actual del short (por acción)
  longMark: number | null;
  adversePremium: number; // $ de flujo agresivo EN CONTRA de la posición
  favorablePremium: number; // $ a favor
  flowLean: "bullish" | "bearish" | "neutral";
  regime: "positive" | "negative";
  defendingWall: number | null; // muro que debería defender (putWall bull_put / callWall bear_call)
  sigma1Pct: number; // move diario 1σ en %
}

export interface PositionStatus {
  action: MonitorAction;
  headline: string;
  reasons: string[];
  distancePts: number; // + = a salvo, − = el short está rebasado
  distanceSigma: number | null;
  breachedShort: boolean;
  breachedBreakeven: boolean;
  currentValue: number | null; // valor actual del spread por 1 contrato ($)
  profitCapturedPct: number | null; // % de la prima ya capturado (recomprar barato = ganancia)
  wallDefends: boolean | null;
  adverse: boolean; // flujo agresivo en contra y dominante
}

const DELTA_DANGER = 0.45; // short cerca de 50/50 → gestionar
const TAKE_PROFIT_PCT = 75; // recomprar por ≤25% del crédito → asegurar la ganancia

/**
 * Evalúa una posición contra el mercado actual. La lógica prioriza el riesgo: primero salir si
 * se rompió el breakeven o el short con flujo en contra, luego take-profit, luego vigilar.
 */
export function monitorPosition(p: MonitorPosition, m: PositionMarket): PositionStatus {
  const isPut = p.kind === "bull_put";
  const breakeven = isPut ? p.shortStrike - p.credit : p.shortStrike + p.credit;
  const distancePts = isPut ? m.spot - p.shortStrike : p.shortStrike - m.spot;
  const sigmaAbs = (m.sigma1Pct / 100) * m.spot;
  const distanceSigma = sigmaAbs > 0 ? distancePts / sigmaAbs : null;
  const breachedShort = distancePts <= 0;
  const breachedBreakeven = isPut ? m.spot <= breakeven : m.spot >= breakeven;

  const currentValue =
    m.shortMark != null && m.longMark != null ? Math.round((m.shortMark - m.longMark) * 100) : null;
  const entry = Math.round(p.credit * 100);
  const profitCapturedPct =
    currentValue != null && entry > 0 ? Math.round(((entry - currentValue) / entry) * 100) : null;

  const wallDefends =
    m.defendingWall == null
      ? null
      : isPut
        ? m.defendingWall > p.shortStrike && m.spot > m.defendingWall
        : m.defendingWall < p.shortStrike && m.spot < m.defendingWall;

  const adverseLean = isPut ? m.flowLean === "bearish" : m.flowLean === "bullish";
  const adverse = adverseLean && m.adversePremium > m.favorablePremium;

  // Señales de proximidad/pérdida que elevan a "vigila" aunque no haya flujo en contra.
  const dangerClose = distanceSigma != null && distanceSigma < 0.5; // pegado al short
  const underwater = profitCapturedPct != null && profitCapturedPct <= -50; // el spread se encareció mucho
  const nearDelta = m.shortDelta != null && m.shortDelta >= 0.4;

  const reasons: string[] = [];
  reasons.push(
    `spot a ${Math.abs(Math.round(distancePts))} pts ${breachedShort ? "PASADO el" : "del"} short` +
      (distanceSigma != null ? ` (${distanceSigma.toFixed(1)}σ)` : ""),
  );
  if (m.shortDelta != null) reasons.push(`delta del short ${m.shortDelta.toFixed(2)}`);
  if (adverse)
    reasons.push(
      `flujo agresivo EN CONTRA ($${(m.adversePremium / 1e6).toFixed(1)}M ${isPut ? "comprando puts" : "comprando calls"})`,
    );
  if (wallDefends === true) reasons.push(`el muro ${m.defendingWall} aún defiende`);
  if (wallDefends === false) reasons.push(`el muro de defensa ya no protege`);
  if (profitCapturedPct != null)
    reasons.push(
      profitCapturedPct >= 0
        ? `llevas ${profitCapturedPct}% de la prima`
        : `vas en contra: el spread vale $${currentValue} vs $${entry} que cobraste`,
    );

  let action: MonitorAction;
  let headline: string;
  if (breachedBreakeven || (breachedShort && adverse)) {
    action = "exit";
    headline = "🔴 Evalúa SALIR — el panorama se volvió en contra";
  } else if (breachedShort || (m.shortDelta != null && m.shortDelta >= DELTA_DANGER)) {
    action = adverse ? "exit" : "watch";
    headline = adverse
      ? "🔴 Evalúa SALIR — cerca del strike y con flujo en contra"
      : "🟡 VIGILA — el precio se acercó al short";
  } else if (profitCapturedPct != null && profitCapturedPct >= TAKE_PROFIT_PCT) {
    action = "take_profit";
    headline = "💰 Considera CERRAR — ya capturaste la mayor parte de la prima";
  } else if (adverse && distanceSigma != null && distanceSigma < 1) {
    action = "watch";
    headline = "🟡 VIGILA — entró flujo en contra (aún defendida)";
  } else if (dangerClose || underwater || nearDelta) {
    action = "watch";
    headline = underwater
      ? "🟡 VIGILA — vas en contra, el spread se encareció"
      : "🟡 VIGILA — el precio está pegado a tu short";
  } else {
    action = "hold";
    headline = "✅ AGUANTA — la posición va bien";
  }

  return {
    action,
    headline,
    reasons,
    distancePts: Math.round(distancePts),
    distanceSigma,
    breachedShort,
    breachedBreakeven,
    currentValue,
    profitCapturedPct,
    wallDefends,
    adverse,
  };
}
