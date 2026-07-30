// SPX 0DTE/1DTE — lógica pura del data layer. Deriva el spot (sin plan de Indices) y
// separa la cadena por DTE. Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { marketDateStr, parseOcc } from "./occ";
import { aggressionOf, type RawTrade } from "./flow";

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
