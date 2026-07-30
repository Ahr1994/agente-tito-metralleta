// Detecta VENTAS de prima grandes en la última media hora del mercado (power hour, 15:30–16:00
// ET) para el vencimiento cercano, y al día siguiente confirma si se sumaron al Open Interest
// (= posiciones abiertas overnight, no day-trades). PURO y testeable.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import type { SpxFlowTrade } from "./spx";
import { daysToExpiration } from "./occ";

/** ¿El timestamp cae en la última media hora de sesión regular (15:30–16:00 ET)? */
export function inClosingWindow(tsMs: number): boolean {
  if (!(tsMs > 0)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(tsMs));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hh * 60 + mm;
  return !["Sat", "Sun"].includes(wd) && mins >= 930 && mins <= 960; // 15:30–16:00
}

export interface ClosingSell {
  strike: number;
  type: "call" | "put";
  expiration: string;
  dte: number;
  totalPremium: number; // $ vendido en el cierre en ese contrato
  totalSize: number; // contratos
  tradeCount: number;
  oiAtTrade: number; // OI reportado (EOD del día anterior)
}

/**
 * Agrupa las VENTAS agresivas (al bid) de la ventana de cierre por contrato, filtra a las
 * grandes (≥ minPremium) y del vencimiento cercano (≤ maxDte). Ordena por premium desc.
 */
export function detectClosingSells(
  trades: SpxFlowTrade[],
  now: Date,
  opts: { minPremium?: number; maxDte?: number } = {},
): ClosingSell[] {
  const minPremium = opts.minPremium ?? 250_000;
  const maxDte = opts.maxDte ?? 3;

  const byContract = new Map<string, ClosingSell>();
  for (const t of trades) {
    if (t.side !== "bid") continue; // venta agresiva = pega al bid
    if (!inClosingWindow(Date.parse(t.timestamp))) continue;
    const dte = daysToExpiration(t.expiration, now);
    if (dte < 0 || dte > maxDte) continue;
    const key = `${t.type}:${t.strike}:${t.expiration}`;
    const e = byContract.get(key);
    if (e) {
      e.totalPremium += t.premium;
      e.totalSize += t.size;
      e.tradeCount += 1;
      e.oiAtTrade = Math.max(e.oiAtTrade, t.oi);
    } else {
      byContract.set(key, {
        strike: t.strike,
        type: t.type,
        expiration: t.expiration,
        dte,
        totalPremium: t.premium,
        totalSize: t.size,
        tradeCount: 1,
        oiAtTrade: t.oi,
      });
    }
  }
  return [...byContract.values()]
    .filter((c) => c.totalPremium >= minPremium)
    .sort((a, b) => b.totalPremium - a.totalPremium);
}

export interface ClosingSellReview extends ClosingSell {
  currentOi: number | null; // OI del día siguiente
  oiChange: number | null; // currentOi − oiAtTrade
  confirmed: boolean; // el OI subió ≈ lo vendido → se abrió y quedó overnight
}

/** Clave de contrato para cruzar con el OI del día siguiente. */
export function contractKey(c: { type: string; strike: number; expiration: string }): string {
  return `${c.type}:${c.strike}:${c.expiration}`;
}

/**
 * Al día siguiente: cruza las ventas guardadas con el OI actual de cada contrato. Si el OI
 * subió al menos la mitad de lo vendido, se confirma que fue apertura mantenida overnight.
 */
export function reviewClosingSells(
  stored: ClosingSell[],
  currentOiByContract: Map<string, number>,
): ClosingSellReview[] {
  return stored.map((c) => {
    const currentOi = currentOiByContract.get(contractKey(c)) ?? null;
    const oiChange = currentOi != null ? currentOi - c.oiAtTrade : null;
    const confirmed = oiChange != null && oiChange >= c.totalSize * 0.5 && oiChange > 0;
    return { ...c, currentOi, oiChange, confirmed };
  });
}
