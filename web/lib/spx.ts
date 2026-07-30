// SPX 0DTE/1DTE — lógica pura del data layer. Deriva el spot (sin plan de Indices) y
// separa la cadena por DTE. Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { marketDateStr } from "./occ";

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
