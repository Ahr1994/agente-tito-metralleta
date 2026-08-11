// Lee la ESTRUCTURA del tape institucional para no confundir un sintético/roll deep-ITM con una
// apuesta direccional. La tape ingenua (institutionalTape.ts) etiqueta cada pata por lado×tipo,
// así un "7800P Aggr.Buy $6.1M" que en realidad es un short sintético (long put + short call al
// mismo strike, 97% intrínseco) sale como "$6.1M bajista" cuando es estructural.
//
// Esta capa AGRUPA las patas simultáneas (mismo timestamp+size = un combo multi-leg), detecta la
// estructura (sintético, vertical, straddle/strangle…), calcula la dirección REAL por delta neto
// de posición y el nocional direccional REAL (no el premium inflado por intrínseco), y marca lo
// ESTRUCTURAL para descontarlo del "flujo limpio". PURO y testeable.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import type { SpxFlowTrade } from "./spx";
import { tapeSide, tapeCond, type TapeSide } from "./institutionalTape";

export interface StructLeg {
  strike: number;
  type: "call" | "put";
  side: TapeSide;
  long: boolean; // Buy / Aggr.Buy = pata larga
  premium: number;
  size: number;
  price: number;
  delta: number | null;
  spot: number | null; // asset_price al momento del print
  cond: "ML" | "SL";
  timestamp: string;
  intrinsic: number; // valor intrínseco por acción al momento del print
  extrinsicPct: number; // % del precio que es valor temporal (0 = puro intrínseco)
  intrinsicHeavy: boolean; // ITM y casi sin prima temporal / |Δ|≥0.88 → se comporta como acción
}

export type StructKind =
  | "synthetic_short" // long put + short call mismo strike = corto sintético
  | "synthetic_long" // long call + short put mismo strike = largo sintético
  | "vertical" // spread vertical (mismo tipo, strikes distintos, direcciones opuestas)
  | "straddle" // long call + long put mismo strike (o short/short) = apuesta de VOL
  | "strangle" // long call + long put strikes distintos = apuesta de VOL
  | "combo" // multi-leg que no encaja limpio → estructural, descontar
  | "single"; // una sola pata

export interface TapeStructure {
  kind: StructKind;
  legs: StructLeg[];
  size: number;
  timestamp: string;
  spot: number | null;
  cond: "ML" | "SL";
  netCash: number; // + = débito neto pagado, − = crédito neto recibido
  headlinePremium: number; // el premium de la pata más grande (lo que grita la tape ingenua)
  netDelta: number; // delta de posición NETO × size (dirección real; corto sintético ≈ −size)
  directionalNotional: number; // $ direccional REAL = |netDelta|×100×spot (no el premium)
  bias: "bullish" | "bearish" | "neutral";
  structural: boolean; // true = descontar el titular (sintético/combo/deep-ITM/vol)
  label: string; // etiqueta corta ES
  note: string; // explicación ES
}

function buildLeg(t: SpxFlowTrade): StructLeg {
  const side = tapeSide(t.rawSide);
  const long = side === "Buy" || side === "Aggr.Buy";
  const spot = t.assetPrice ?? 0;
  const intrinsic =
    t.type === "put" ? Math.max(0, t.strike - spot) : Math.max(0, spot - t.strike);
  const extrinsicPct = t.price > 0 ? Math.max(0, t.price - intrinsic) / t.price : 1;
  const intrinsicHeavy =
    spot > 0 &&
    intrinsic > 0 &&
    (extrinsicPct < 0.2 || (t.delta != null && Math.abs(t.delta) >= 0.88));
  return {
    strike: t.strike,
    type: t.type,
    side,
    long,
    premium: t.premium,
    size: t.size,
    price: t.price,
    delta: t.delta,
    spot: t.assetPrice ?? null,
    cond: tapeCond(t.conditionId),
    timestamp: t.timestamp,
    intrinsic,
    extrinsicPct,
    intrinsicHeavy,
  };
}

/** Delta de posición de una pata: signo largo/corto × delta del contrato (put ya es negativo). */
function legPosDelta(l: StructLeg): number {
  const d = l.delta != null ? l.delta : l.type === "call" ? 0.5 : -0.5;
  return (l.long ? 1 : -1) * d;
}

// Umbral pequeño: en un vertical los deltas se cancelan parcialmente (neto ~0.08), así que
// 0.15 lo dejaría "neutral". Las estructuras de VOL (straddle/strangle) se fuerzan neutral aparte.
function biasFromDelta(netDeltaPerContract: number): "bullish" | "bearish" | "neutral" {
  if (netDeltaPerContract > 0.05) return "bullish";
  if (netDeltaPerContract < -0.05) return "bearish";
  return "neutral";
}

/** Clasifica un grupo de patas simultáneas (1 = single; ≥2 = combo multi-leg). */
export function classifyStructure(legs: StructLeg[]): TapeStructure {
  const size = legs[0]?.size ?? 0;
  const spotVal = legs.find((l) => l.spot != null && l.spot > 0)?.spot ?? null;
  const cond: "ML" | "SL" = legs.length > 1 ? "ML" : legs[0]?.cond ?? "SL";
  const netCash = legs.reduce((s, l) => s + (l.long ? l.premium : -l.premium), 0);
  const headlinePremium = Math.max(...legs.map((l) => l.premium));
  const netDeltaPer = legs.reduce((s, l) => s + legPosDelta(l), 0);
  const netDelta = netDeltaPer * size;
  const directionalNotional = Math.abs(netDelta) * 100 * (spotVal ?? 0);
  let bias = biasFromDelta(netDeltaPer);

  const puts = legs.filter((l) => l.type === "put");
  const calls = legs.filter((l) => l.type === "call");
  const anyIntrinsic = legs.some((l) => l.intrinsicHeavy);

  let kind: StructKind = legs.length === 1 ? "single" : "combo";
  let label = "";
  let note = "";
  let structural = false;

  if (legs.length === 1) {
    const l = legs[0];
    kind = "single";
    structural = l.intrinsicHeavy;
    const dir = bias === "bullish" ? "alcista" : bias === "bearish" ? "bajista" : "neutral";
    label = l.intrinsicHeavy ? `deep-ITM ${l.type === "put" ? "put" : "call"}` : `${l.side} ${l.type}`;
    note = l.intrinsicHeavy
      ? `Deep-ITM (${(l.extrinsicPct * 100).toFixed(0)}% prima temporal, Δ${l.delta?.toFixed(2) ?? "?"}) — casi puro intrínseco, se comporta como acción, no es apuesta de prima. Descuenta el titular.`
      : `Una pata (${cond}), ${dir}. ${cond === "SL" ? "Single-leg = señal limpia." : ""}`.trim();
  } else if (legs.length === 2 && puts.length === 1 && calls.length === 1) {
    const put = puts[0];
    const call = calls[0];
    if (put.strike === call.strike && put.long !== call.long) {
      // sintético: mismo strike, direcciones opuestas
      if (put.long && !call.long) {
        kind = "synthetic_short";
        label = `short sintético ${put.strike}`;
        note = `Long put + short call al MISMO strike ${put.strike} = CORTO SINTÉTICO (≈ short ${size} "acciones" ×100). El premium grande ($${(headlinePremium / 1e6).toFixed(1)}M) es casi todo intrínseco — NO es una apuesta bajista de ese tamaño. Suele ser hedge/roll. Estructural: descuenta el titular.`;
      } else {
        kind = "synthetic_long";
        label = `long sintético ${put.strike}`;
        note = `Long call + short put al MISMO strike ${put.strike} = LARGO SINTÉTICO. El titular exagera; es estructural (hedge/roll). Descuenta.`;
      }
      structural = true;
    } else if (put.long && call.long) {
      kind = put.strike === call.strike ? "straddle" : "strangle";
      label = `${kind} ${put.strike}/${call.strike}`;
      note = `Long call + long put = apuesta de VOLATILIDAD (${kind}), no direccional. Neutral.`;
      structural = true;
    } else if (!put.long && !call.long) {
      kind = put.strike === call.strike ? "straddle" : "strangle";
      label = `${kind} vendido ${put.strike}/${call.strike}`;
      note = `Short call + short put = VENTA de volatilidad (${kind} corto). Neutral direccional.`;
      structural = true;
    } else {
      kind = "combo";
      label = "combo put+call";
      note = `Combo put+call de strikes distintos. Estructural: lee por delta neto (${bias}).`;
      structural = true;
    }
  } else if (legs.length === 2 && (puts.length === 2 || calls.length === 2)) {
    const [a, b] = legs;
    if (a.long !== b.long) {
      kind = "vertical";
      const t = puts.length === 2 ? "put" : "call";
      label = `vertical ${t} ${a.strike}/${b.strike}`;
      note = `Spread vertical de ${t}s (${bias}). Direccional de riesgo definido — cuenta al delta neto, no al premium bruto.`;
      structural = false;
    } else {
      kind = "combo";
      label = "combo mismo tipo";
      note = `Dos ${puts.length === 2 ? "puts" : "calls"} en la misma dirección. Estructural.`;
      structural = true;
    }
  } else {
    kind = "combo";
    label = `combo ${legs.length} patas`;
    note = `Multi-leg de ${legs.length} patas — estructural. Dirección por delta neto: ${bias}.`;
    structural = true;
  }

  // Cualquier estructura con patas deep-ITM (intrínseco) es financiamiento/box/stock-replacement,
  // no una apuesta de prima limpia — un vertical 9500/9000 con SPX en 7750 son puros boxes.
  if (anyIntrinsic) structural = true;
  if (kind === "straddle" || kind === "strangle") bias = "neutral"; // apuesta de VOL

  return {
    kind,
    legs,
    size,
    timestamp: legs[0]?.timestamp ?? "",
    spot: spotVal,
    cond,
    netCash,
    headlinePremium,
    netDelta,
    directionalNotional,
    bias,
    structural,
    label,
    note,
  };
}

export interface TapeRead {
  structures: TapeStructure[]; // más grandes (por nocional direccional) primero
  rawBullish: number; // titular ingenuo (premium por lado×tipo) — para comparar
  rawBearish: number;
  rawLean: "bullish" | "bearish" | "neutral";
  cleanBullish: number; // solo prints direccionales LIMPIOS (single-leg, no intrínseco)
  cleanBearish: number;
  cleanLean: "bullish" | "bearish" | "neutral";
  structuralPremium: number; // premium atado a sintéticos/combos/deep-ITM (descontado)
  topClean: TapeStructure[]; // los mayores prints limpios (la señal real)
}

/**
 * Lee el tape completo: agrupa combos simultáneos, clasifica, y separa el flujo LIMPIO
 * (single-leg direccional no-intrínseco) del ESTRUCTURAL (sintéticos/combos/deep-ITM/vol).
 */
export function readTape(
  trades: SpxFlowTrade[],
  opts: { minPremium?: number; limit?: number } = {},
): TapeRead {
  const minPremium = opts.minPremium ?? 250_000;
  const limit = opts.limit ?? 40;
  // Piso BAJO para agrupar: la pata OTM de un sintético es chica (el 7800C eran $21k) y si la
  // filtramos antes de agrupar perdemos el combo. Agrupamos con el piso, luego exigimos que el
  // TITULAR del grupo (su pata mayor) llegue a minPremium para considerarlo material.
  const groupFloor = Math.min(minPremium, 10_000);
  const forGroup = trades.filter((t) => t.premium >= groupFloor);

  // agrupar por (timestamp, size): las patas de un mismo combo multi-leg comparten ambos
  const groups = new Map<string, SpxFlowTrade[]>();
  for (const t of forGroup) {
    const multi = tapeCond(t.conditionId) === "ML";
    const key = multi ? `${t.timestamp}|${t.size}` : `${t.timestamp}|${t.size}|${t.strike}|${t.type}|solo`;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  const structures: TapeStructure[] = [];
  let cleanBull = 0;
  let cleanBear = 0;
  let structuralPremium = 0;
  let rawBull = 0;
  let rawBear = 0;
  for (const g of groups.values()) {
    const legs = g.map(buildLeg);
    const s = classifyStructure(legs);
    if (s.headlinePremium < minPremium) continue; // no material
    structures.push(s);
    const groupPremium = legs.reduce((acc, l) => acc + l.premium, 0);
    // titular ingenuo (igual que institutionalTape): cada pata por lado×tipo
    for (const l of legs) {
      const isBuy = l.side === "Buy" || l.side === "Aggr.Buy";
      const isSell = l.side === "Sell" || l.side === "Aggr.Sell";
      if ((isBuy && l.type === "call") || (isSell && l.type === "put")) rawBull += l.premium;
      else if ((isBuy && l.type === "put") || (isSell && l.type === "call")) rawBear += l.premium;
    }
    if (s.structural || s.kind === "straddle" || s.kind === "strangle") {
      structuralPremium += groupPremium;
    } else if (s.bias === "bullish") {
      cleanBull += groupPremium;
    } else if (s.bias === "bearish") {
      cleanBear += groupPremium;
    }
  }

  structures.sort((a, b) => {
    // limpios grandes primero, luego por nocional direccional, luego por hora
    if (a.structural !== b.structural) return a.structural ? 1 : -1;
    if (b.directionalNotional !== a.directionalNotional)
      return b.directionalNotional - a.directionalNotional;
    return a.timestamp < b.timestamp ? 1 : -1;
  });

  const leanOf = (bull: number, bear: number): "bullish" | "bearish" | "neutral" => {
    const tot = bull + bear;
    const net = tot > 0 ? ((bull - bear) / tot) * 100 : 0;
    return net > 15 ? "bullish" : net < -15 ? "bearish" : "neutral";
  };

  const topClean = structures
    .filter((s) => !s.structural && s.bias !== "neutral")
    .slice(0, 8);

  return {
    structures: structures.slice(0, limit),
    rawBullish: rawBull,
    rawBearish: rawBear,
    rawLean: leanOf(rawBull, rawBear),
    cleanBullish: cleanBull,
    cleanBearish: cleanBear,
    cleanLean: leanOf(cleanBull, cleanBear),
    structuralPremium,
    topClean,
  };
}
