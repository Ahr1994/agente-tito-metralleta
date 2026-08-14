// Mapa de flujo MULTI-EXPIRACIÓN para swing/direccional. Netea la compra/venta de calls y puts por
// (tipo, strike, expiración) a lo largo de TODA la cadena (near → ≥3 meses) para detectar
// DIVERGENCIAS: p.ej. calls compradas en Sept (alcista) pero VENDIDAS en Oct al mismo strike
// (techo con timing → upside limitado). Nace de HON: se recomendó siguiendo el 240C Sept comprado
// sin ver que el 240C Oct se estaba vendiendo. PURO y testeable.
//
// Netea por SIZE (no solo premium): un round-trip (comprar 92k @ $3.45 y vender 92k @ $1.43 el
// mismo día, como el SHOP 160C) tiene net premium + pero net size ≈ 0 = estructural, NO direccional.

import { tapeSide } from "./institutionalTape";
import { daysToExpiration } from "./occ";

export interface SwingPrint {
  strike: number;
  type: "call" | "put";
  expiration: string;
  rawSide: string;
  premium: number;
  size: number;
  oi: number;
  delta: number | null;
  spot: number | null;
  price: number;
}

export type FlowRole = "accumulate" | "write" | "roundtrip" | "minor";

export interface StrikeFlow {
  strike: number;
  type: "call" | "put";
  expiration: string;
  dte: number;
  otmPct: number;
  boughtSize: number;
  soldSize: number;
  netSize: number;
  boughtPrem: number;
  soldPrem: number;
  netPrem: number;
  role: FlowRole;
}

export interface SwingDivergence {
  strike: number;
  type: "call" | "put";
  accExp: string; // expiración acumulada (comprada)
  writeExp: string; // expiración escrita (vendida)
  note: string;
}

export interface SwingFlowMap {
  spot: number;
  minDte: number;
  maxDte: number;
  strikes: StrikeFlow[]; // flujo material por strike+exp (más grande primero)
  callAccum: StrikeFlow[]; // calls net COMPRADAS (alcista)
  callCeilings: StrikeFlow[]; // calls net VENDIDAS (techo)
  putFloors: StrikeFlow[]; // puts net VENDIDAS (piso)
  divergences: SwingDivergence[]; // techos con timing (compra near / venta far)
  bias: "bullish" | "bearish" | "capped" | "structural" | "mixed";
  verdict: string;
}

function classify(f: StrikeFlow, minPrem: number): FlowRole {
  const gross = f.boughtSize + f.soldSize;
  if (f.boughtPrem + f.soldPrem < minPrem || gross === 0) return "minor";
  if (Math.abs(f.netSize) < 0.25 * gross) return "roundtrip"; // compró y vendió ≈ igual = estructural
  return f.netSize > 0 ? "accumulate" : "write";
}

/**
 * Construye el mapa de flujo multi-expiración. Considera expiraciones entre minDte y maxDte
 * (default 7–250 días para cubrir near → ≥3 meses). Excluye deep-ITM (estructural).
 */
export function swingFlowMap(
  prints: SwingPrint[],
  now: Date = new Date(),
  opts: { minDte?: number; maxDte?: number; minPremium?: number } = {},
): SwingFlowMap {
  const minDte = opts.minDte ?? 7;
  const maxDte = opts.maxDte ?? 250;
  const minPremium = opts.minPremium ?? 500_000;
  const spot = prints.find((p) => (p.spot ?? 0) > 0)?.spot ?? 0;

  const byKey = new Map<string, StrikeFlow>();
  for (const p of prints) {
    const dte = daysToExpiration(p.expiration, now) as number;
    if (dte < minDte || dte > maxDte) continue;
    const s = spot > 0 ? spot : p.spot ?? 0;
    if (!(s > 0)) continue;
    // excluir deep-ITM (estructural, se comporta como acción)
    const intrinsic = p.type === "put" ? Math.max(0, p.strike - s) : Math.max(0, s - p.strike);
    const extrinsicPct = p.price > 0 ? Math.max(0, p.price - intrinsic) / p.price : 1;
    const deepItm = intrinsic > 0 && (extrinsicPct < 0.2 || (p.delta != null && Math.abs(p.delta) >= 0.88));
    if (deepItm) continue;
    const side = tapeSide(p.rawSide);
    const isBuy = side === "Buy" || side === "Aggr.Buy";
    const isSell = side === "Sell" || side === "Aggr.Sell";
    if (!isBuy && !isSell) continue;
    const key = `${p.type}|${p.strike}|${p.expiration}`;
    let f = byKey.get(key);
    if (!f) {
      f = {
        strike: p.strike, type: p.type, expiration: p.expiration, dte,
        otmPct: p.type === "put" ? (s - p.strike) / s : (p.strike - s) / s,
        boughtSize: 0, soldSize: 0, netSize: 0, boughtPrem: 0, soldPrem: 0, netPrem: 0, role: "minor",
      };
      byKey.set(key, f);
    }
    if (isBuy) { f.boughtSize += p.size; f.boughtPrem += p.premium; }
    else { f.soldSize += p.size; f.soldPrem += p.premium; }
  }

  const strikes: StrikeFlow[] = [];
  for (const f of byKey.values()) {
    f.netSize = f.boughtSize - f.soldSize;
    f.netPrem = f.boughtPrem - f.soldPrem;
    f.role = classify(f, minPremium);
    if (f.role !== "minor") strikes.push(f);
  }
  strikes.sort((a, b) => Math.max(b.boughtPrem, b.soldPrem) - Math.max(a.boughtPrem, a.soldPrem));

  const callAccum = strikes.filter((f) => f.type === "call" && f.role === "accumulate");
  const callCeilings = strikes.filter((f) => f.type === "call" && f.role === "write");
  const putFloors = strikes.filter((f) => f.type === "put" && f.role === "write");

  // DIVERGENCIAS: mismo strike (±3%) con una exp acumulada y otra escrita = techo con timing
  const divergences: SwingDivergence[] = [];
  for (const acc of callAccum) {
    for (const wr of callCeilings) {
      if (Math.abs(acc.strike - wr.strike) / (spot || acc.strike) <= 0.03) {
        divergences.push({
          strike: acc.strike, type: "call", accExp: acc.expiration, writeExp: wr.expiration,
          note: `Calls ${acc.strike} COMPRADAS en ${acc.expiration.slice(5)} pero VENDIDAS en ${wr.expiration.slice(5)} → alcista corto plazo pero TECHO en ${acc.strike}; upside limitado ahí.`,
        });
      }
    }
  }

  // veredicto
  const accP = callAccum.reduce((s, f) => s + f.netPrem, 0);
  const ceilP = callCeilings.reduce((s, f) => s + (f.soldPrem - f.boughtPrem), 0);
  const roundtrips = strikes.filter((f) => f.role === "roundtrip");
  let bias: SwingFlowMap["bias"];
  let verdict: string;
  if (roundtrips.length && roundtrips.reduce((s, f) => s + f.boughtPrem + f.soldPrem, 0) > accP + ceilP) {
    bias = "structural";
    verdict = "El flujo grande es ROUND-TRIP (compró y vendió) = estructural, NO direccional. No lo sigas como whale.";
  } else if (divergences.length) {
    bias = "capped";
    verdict = `Alcista de corto plazo PERO con TECHO escrito en ${divergences[0].strike} (${divergences[0].writeExp.slice(5)}) → upside limitado. Considera strike ABAJO del techo, no una call en el strike topado.`;
  } else if (accP > 0 && ceilP <= accP * 0.4) {
    bias = "bullish";
    verdict = "Acumulación de calls consistente en varias expiraciones, sin techo grande en contra → tesis alcista limpia.";
  } else if (ceilP > accP) {
    bias = "bearish";
    verdict = "Domina la VENTA de calls (techos) sobre la compra → sesgo bajista/capado, no alcista.";
  } else {
    bias = "mixed";
    verdict = "Flujo mixto entre expiraciones — sin dirección de convicción clara.";
  }

  return { spot, minDte, maxDte, strikes: strikes.slice(0, 30), callAccum, callCeilings, putFloors, divergences, bias, verdict };
}
