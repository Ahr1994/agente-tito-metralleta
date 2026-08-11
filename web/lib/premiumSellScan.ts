// Escanea DÓNDE venden prima 0DTE/1DTE: netea ventas (al bid) − compras (al ask) por strike sobre
// las opciones OTM del plazo corto. A diferencia del tape (que captura prints GRANDES, casi todos
// lejanos), esto usa el flujo con piso BAJO para cazar la venta de prima 0DTE, que es alto volumen
// y prima chica por print. Puts vendidos = soporte (piso alcista); calls vendidos = resistencia.
// Si los puts se COMPRAN (no venden) = no hay piso defendido, día defensivo. PURO y testeable.

import { tapeSide } from "./institutionalTape";
import { daysToExpiration } from "./occ";

export interface PremSellPrint {
  strike: number;
  type: "call" | "put";
  expiration: string;
  rawSide: string;
  size: number;
  premium: number;
}

export interface PremSellWall {
  strike: number;
  type: "call" | "put";
  dte: number;
  wall: "soporte" | "resistencia";
  netSold: number; // ventas − compras ($)
  sells: number;
  buys: number;
  aggr: number; // parte agresiva (below-bid) de las ventas
  size: number; // contratos netos vendidos
  otmPct: number;
}

export type PremSellLean =
  | "put_support" // dominan ventas de puts = piso alcista
  | "call_resistance" // dominan ventas de calls = techo bajista
  | "defensive_puts" // COMPRAN puts = protección, sin piso
  | "mixed"
  | "quiet"; // nada significativo

export interface PremSellScan {
  walls: PremSellWall[];
  putWriting: number; // prima NETA vendida en puts (soporte)
  callWriting: number; // prima NETA vendida en calls (resistencia)
  putBuying: number; // puts COMPRADOS neto (defensivo, no piso)
  callBuying: number;
  lean: PremSellLean;
  considered: number; // prints 0-1DTE OTM procesados
  note: string;
}

export function scanPremiumSells(
  prints: PremSellPrint[],
  spot: number,
  opts: { now?: Date; maxDte?: number; minWall?: number } = {},
): PremSellScan {
  const now = opts.now ?? new Date();
  const maxDte = opts.maxDte ?? 1;
  // piso BAJO por strike: el 0DTE tiene prima chica y repartida, $50k por strike era muy alto
  const minWall = opts.minWall ?? 25_000;
  const map = new Map<string, PremSellWall>();
  let considered = 0;

  for (const p of prints) {
    if (!(spot > 0)) break;
    const dte = daysToExpiration(p.expiration, now) as number;
    if (dte < 0 || dte > maxDte) continue;
    const otm = p.type === "put" ? p.strike < spot : p.strike > spot;
    if (!otm) continue;
    const side = tapeSide(p.rawSide);
    const isSell = side === "Sell" || side === "Aggr.Sell";
    const isBuy = side === "Buy" || side === "Aggr.Buy";
    if (!isSell && !isBuy) continue;
    considered++;
    const key = `${p.strike}|${p.type}|${dte}`;
    let w = map.get(key);
    if (!w) {
      w = {
        strike: p.strike, type: p.type, dte,
        wall: p.type === "put" ? "soporte" : "resistencia",
        netSold: 0, sells: 0, buys: 0, aggr: 0, size: 0,
        otmPct: p.type === "put" ? (spot - p.strike) / spot : (p.strike - spot) / spot,
      };
      map.set(key, w);
    }
    if (isSell) {
      w.netSold += p.premium; w.sells += p.premium; w.size += p.size;
      if (side === "Aggr.Sell") w.aggr += p.premium;
    } else {
      w.netSold -= p.premium; w.buys += p.premium; w.size -= p.size;
    }
  }

  let putWriting = 0, callWriting = 0, putBuying = 0, callBuying = 0;
  for (const w of map.values()) {
    if (w.type === "put") w.netSold > 0 ? (putWriting += w.netSold) : (putBuying += -w.netSold);
    else w.netSold > 0 ? (callWriting += w.netSold) : (callBuying += -w.netSold);
  }

  const walls = [...map.values()]
    .filter((w) => w.netSold >= minWall)
    .sort((a, b) => b.netSold - a.netSold)
    .slice(0, 12);

  // lean por la actividad dominante
  const buckets: [PremSellLean, number][] = [
    ["put_support", putWriting],
    ["call_resistance", callWriting],
    ["defensive_puts", putBuying],
  ];
  buckets.sort((a, b) => b[1] - a[1]);
  const [topLean, topVal] = buckets[0];
  let lean: PremSellLean;
  let note: string;
  if (topVal < minWall) {
    lean = "quiet";
    note = "Sin venta de prima 0-1DTE significativa — día quieto o flujo balanceado.";
  } else {
    const second = buckets[1][1];
    lean = second > topVal * 0.6 ? "mixed" : topLean;
    if (lean === "call_resistance") {
      note = `Venden CALLS (techo/resistencia) — vender prima del lado call (bear call) va con la corriente.${putBuying > callWriting * 0.4 ? " Y COMPRAN puts (defensivo) — el piso NO está defendido, cuidado con bull put." : ""}`;
    } else if (lean === "put_support") {
      note = "Venden PUTS (piso/soporte) — vender prima del lado put (bull put) tiene compañía institucional.";
    } else if (lean === "defensive_puts") {
      note = "COMPRAN puts (defensivo/direccional bajista) — NO hay piso de put-writing; vender puts iría contra el flujo.";
    } else {
      note = "Flujo mixto — venta de prima en ambos lados sin dominancia clara.";
    }
  }

  return { walls, putWriting, callWriting, putBuying, callBuying, lean, considered, note };
}
