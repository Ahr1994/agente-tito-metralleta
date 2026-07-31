// Tape institucional del SPX: los prints GRANDES del flujo (los que mueven la foto de gamma),
// igual que la "Institutional Flow Tape" de la vista GEX de MarketSnack. PURO y testeable.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import type { SpxFlowTrade } from "./spx";
import { isMultiLegCondition } from "./conditions";

export type TapeSide = "Buy" | "Sell" | "Aggr.Buy" | "Aggr.Sell" | "Mid";

/** Etiqueta de lado como en la tape: al ask = compra, al bid = venta, fuera = agresivo. */
export function tapeSide(rawSide: string): TapeSide {
  switch (rawSide.toUpperCase()) {
    case "ABOVE_ASK":
      return "Aggr.Buy";
    case "AT_ASK":
    case "ASKSIDE":
      return "Buy";
    case "AT_BID":
    case "BIDSIDE":
      return "Sell";
    case "BELOW_BID":
      return "Aggr.Sell";
    default:
      return "Mid";
  }
}

/** Condición: ML (multi-leg) o SL (single-leg), como muestra la tape. */
export function tapeCond(conditionId: number | null): "ML" | "SL" {
  return isMultiLegCondition(conditionId) ? "ML" : "SL";
}

export interface TapePrint {
  strike: number;
  type: "call" | "put";
  side: TapeSide;
  bullish: boolean; // comprar call / vender put = alcista; comprar put / vender call = bajista
  premium: number;
  size: number;
  cond: "ML" | "SL";
  spot: number | null; // asset_price al momento del print
  timestamp: string;
}

export interface InstitutionalTape {
  prints: TapePrint[]; // más reciente primero
  premiumTotal: number; // suma de premium de los prints capturados
  count: number;
  bullishPremium: number; // presión alcista (compras de calls + ventas de puts)
  bearishPremium: number; // presión bajista (compras de puts + ventas de calls)
  lean: "bullish" | "bearish" | "neutral";
}

/**
 * Filtra el flujo a los prints institucionales (≥ minPremium), los etiqueta como en la tape y
 * resume el sesgo (compras de calls + ventas de puts = alcista). Ordena por hora desc.
 */
export function institutionalTape(
  trades: SpxFlowTrade[],
  opts: { minPremium?: number; limit?: number } = {},
): InstitutionalTape {
  const minPremium = opts.minPremium ?? 100_000;
  const limit = opts.limit ?? 60;

  const big = trades.filter((t) => t.premium >= minPremium);
  let bull = 0;
  let bear = 0;
  const all: TapePrint[] = big.map((t) => {
    const side = tapeSide(t.rawSide);
    const isBuy = side === "Buy" || side === "Aggr.Buy";
    const isSell = side === "Sell" || side === "Aggr.Sell";
    const bullish = (isBuy && t.type === "call") || (isSell && t.type === "put");
    const bearish = (isBuy && t.type === "put") || (isSell && t.type === "call");
    if (bullish) bull += t.premium;
    else if (bearish) bear += t.premium;
    return {
      strike: t.strike,
      type: t.type,
      side,
      bullish,
      premium: t.premium,
      size: t.size,
      cond: tapeCond(t.conditionId),
      spot: t.assetPrice,
      timestamp: t.timestamp,
    };
  });
  all.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const total = bull + bear;
  const netPct = total > 0 ? ((bull - bear) / total) * 100 : 0;
  return {
    prints: all.slice(0, limit),
    premiumTotal: big.reduce((s, t) => s + t.premium, 0),
    count: big.length,
    bullishPremium: bull,
    bearishPremium: bear,
    lean: netPct > 15 ? "bullish" : netPct < -15 ? "bearish" : "neutral",
  };
}
