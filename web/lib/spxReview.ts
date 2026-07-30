// Evalúa los credit spreads SPX guardados contra lo que pasó de verdad: ¿expiró OTM (te
// quedaste el crédito) o rompió el short? Deriva el P&L realizado y tu track record real
// (win-rate, EV realizado, y si le ganas al ProbOTM que prometía el modelo). PURO y testeable.
// Settlement = SPX derivado del cierre (SPY×10, el índice da 403). Ver spxServer.ts
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import type { SpxTrade } from "./spxTradeStore";

export type SpxOutcome = "win" | "loss" | "partial" | "pending";

export interface SpxTradeReview {
  trade: SpxTrade;
  settlement: number | null; // nivel de SPX en la expiración (proxy SPY×10)
  outcome: SpxOutcome;
  realizedPnL: number | null; // $ por 1 spread (positivo = ganancia)
  maxWin: number; // crédito × 100
  maxLoss: number; // (width − crédito) × 100
}

/**
 * Evalúa un trade contra el settlement. `settlement` = null si aún no ha vencido (pending).
 * bull_put gana si el settlement ≥ short; bear_call gana si ≤ short. Entre short y long es
 * parcial; más allá del long es máx pérdida.
 */
export function reviewSpxTrade(trade: SpxTrade, settlement: number | null): SpxTradeReview {
  const maxWin = Math.round(trade.credit * 100);
  const width = trade.width || Math.abs(trade.shortStrike - trade.longStrike);
  const maxLoss = Math.max(0, Math.round((width - trade.credit) * 100));

  if (settlement == null) {
    return { trade, settlement: null, outcome: "pending", realizedPnL: null, maxWin, maxLoss };
  }

  const { kind, shortStrike, longStrike } = trade;
  let outcome: SpxOutcome;
  let pnl: number;
  if (kind === "bull_put") {
    if (settlement >= shortStrike) {
      outcome = "win";
      pnl = maxWin;
    } else if (settlement <= longStrike) {
      outcome = "loss";
      pnl = -maxLoss;
    } else {
      outcome = "partial";
      pnl = Math.round(maxWin - (shortStrike - settlement) * 100);
    }
  } else {
    // bear_call
    if (settlement <= shortStrike) {
      outcome = "win";
      pnl = maxWin;
    } else if (settlement >= longStrike) {
      outcome = "loss";
      pnl = -maxLoss;
    } else {
      outcome = "partial";
      pnl = Math.round(maxWin - (settlement - shortStrike) * 100);
    }
  }
  return { trade, settlement, outcome, realizedPnL: pnl, maxWin, maxLoss };
}

export interface SpxTrackRecord {
  total: number;
  pending: number;
  closed: number; // ya vencidos
  wins: number; // expiró OTM (crédito completo)
  winRate: number | null; // % sobre cerrados
  totalPnL: number; // $ neto de los cerrados
  realizedEvPerTrade: number | null; // $ promedio por trade cerrado
  avgProbOTM: number | null; // ProbOTM promedio que prometía el modelo
  edgeVsProb: number | null; // winRate − avgProbOTM (>0 = le ganas al modelo)
}

/** Resume los reviews en tu track record real. */
export function summarizeSpxTrades(reviews: SpxTradeReview[]): SpxTrackRecord {
  const closedR = reviews.filter((r) => r.outcome !== "pending");
  const closed = closedR.length;
  const wins = closedR.filter((r) => r.outcome === "win").length;
  const totalPnL = closedR.reduce((s, r) => s + (r.realizedPnL ?? 0), 0);
  const probs = closedR.map((r) => r.trade.probOTM).filter((p): p is number => p != null);
  const avgProbOTM = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
  const winRate = closed ? (wins / closed) * 100 : null;

  return {
    total: reviews.length,
    pending: reviews.length - closed,
    closed,
    wins,
    winRate,
    totalPnL,
    realizedEvPerTrade: closed ? Math.round(totalPnL / closed) : null,
    avgProbOTM: avgProbOTM != null ? Math.round(avgProbOTM) : null,
    edgeVsProb: winRate != null && avgProbOTM != null ? Math.round(winRate - avgProbOTM) : null,
  };
}
