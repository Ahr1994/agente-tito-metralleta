// Confirma si un print GRANDE de "apertura" realmente creó una posición, cruzándolo con el Open
// Interest de la sesión siguiente. Nació de WULF: un print de "30,000 18C Aggr.Buy $19M" parecía
// un whale alcista, pero el OI del día siguiente NO subió (seguía en ~5,180, no ~35,000) → era un
// cierre/roll/cross, NO una apuesta nueva. Sin esta confirmación, el "Aggr.Buy" es señal falsa.
//
// El OI que trae cada trade es el EOD ANTERIOR (oiAtTrade). Para confirmar, en la sesión T+1 se
// mira el OI actual del contrato: si subió ~el tamaño del print → cuajó; si sigue plano/bajó → no.
// PURO y testeable.

import { tapeSide, type TapeSide } from "./institutionalTape";

export interface FlowPrint {
  strike: number;
  type: "call" | "put";
  expiration: string;
  rawSide: string;
  size: number;
  premium: number;
  oi: number; // OI reportado al momento del trade = EOD anterior
  timestamp: string;
  delta?: number | null;
}

export interface OpeningCandidate {
  key: string; // strike|type|expiration
  strike: number;
  type: "call" | "put";
  expiration: string;
  side: TapeSide; // lado agresivo dominante
  intent: "bullish" | "bearish" | "neutral"; // compra call / venta put = alcista
  size: number; // contratos agregados del print (mismo lado, mismo contrato, la sesión)
  premium: number;
  oiAtTrade: number; // OI EOD anterior
  timestamp: string; // el print más grande
  sizeVsOi: number; // size / oiAtTrade (grande = parece posición nueva; >1 = imposible que sea cierre)
}

/**
 * Agrupa los prints grandes por contrato+intención y devuelve los que PARECEN aperturas: agresivos
 * (compra al ask / venta al bid) y con size relevante vs el OI previo. Estos son los que hay que
 * confirmar mañana contra el OI.
 */
export function detectOpeningCandidates(
  prints: FlowPrint[],
  opts: { minPremium?: number; minSizeVsOi?: number; minSizeAbs?: number } = {},
): OpeningCandidate[] {
  const minPremium = opts.minPremium ?? 500_000;
  const minSizeVsOi = opts.minSizeVsOi ?? 0.5; // size ≥ 50% del OI previo = parece nuevo
  const minSizeAbs = opts.minSizeAbs ?? 1000;

  const byKey = new Map<string, OpeningCandidate & { _oiMax: number }>();
  for (const p of prints) {
    const side = tapeSide(p.rawSide);
    const isBuy = side === "Buy" || side === "Aggr.Buy";
    const isSell = side === "Sell" || side === "Aggr.Sell";
    if (!isBuy && !isSell) continue; // mid = no direccional
    const intent: OpeningCandidate["intent"] =
      (isBuy && p.type === "call") || (isSell && p.type === "put")
        ? "bullish"
        : (isBuy && p.type === "put") || (isSell && p.type === "call")
          ? "bearish"
          : "neutral";
    // separamos por intención para no mezclar compras y ventas del mismo contrato
    const dir = isBuy ? "B" : "S";
    const key = `${p.strike}|${p.type}|${p.expiration}|${dir}`;
    const e = byKey.get(key);
    if (e) {
      e.size += p.size;
      e.premium += p.premium;
      e._oiMax = Math.max(e._oiMax, p.oi);
      if (p.premium > 0 && p.timestamp > e.timestamp) e.timestamp = p.timestamp;
    } else {
      byKey.set(key, {
        key: `${p.strike}|${p.type}|${p.expiration}`,
        strike: p.strike,
        type: p.type,
        expiration: p.expiration,
        side,
        intent,
        size: p.size,
        premium: p.premium,
        oiAtTrade: p.oi,
        timestamp: p.timestamp,
        sizeVsOi: 0,
        _oiMax: p.oi,
      });
    }
  }

  const out: OpeningCandidate[] = [];
  for (const c of byKey.values()) {
    c.oiAtTrade = c._oiMax;
    c.sizeVsOi = c.oiAtTrade > 0 ? c.size / c.oiAtTrade : Infinity;
    const looksNew = c.sizeVsOi >= minSizeVsOi || c.size >= minSizeAbs * 5;
    if (c.premium >= minPremium && c.size >= minSizeAbs && looksNew) {
      const { _oiMax, ...clean } = c;
      void _oiMax;
      out.push(clean);
    }
  }
  return out.sort((a, b) => b.premium - a.premium);
}

export type OiVerdict = "confirmed" | "partial" | "not_confirmed" | "pending";

export interface OiConfirmation {
  candidate: OpeningCandidate;
  currentOi: number | null; // OI en la sesión de confirmación (T+1); null = aún no disponible
  deltaOi: number | null; // currentOi - oiAtTrade
  confirmedPct: number | null; // deltaOi / size
  verdict: OiVerdict;
  label: string;
  note: string;
}

/**
 * Confirma un candidato contra el OI de la sesión siguiente. currentOi null → pending (mismo día,
 * el OI aún no refleja el print). Cuajó si el OI subió ≥50% del tamaño; fantasma si <20%.
 */
export function confirmOpening(
  candidate: OpeningCandidate,
  currentOi: number | null,
): OiConfirmation {
  if (currentOi == null || !(currentOi >= 0)) {
    return {
      candidate,
      currentOi: null,
      deltaOi: null,
      confirmedPct: null,
      verdict: "pending",
      label: "pendiente",
      note: "OI de confirmación aún no disponible (el OI refleja el print recién al día siguiente).",
    };
  }
  const deltaOi = currentOi - candidate.oiAtTrade;
  const confirmedPct = candidate.size > 0 ? deltaOi / candidate.size : 0;
  const impossibleClose = candidate.sizeVsOi > 1; // size > OI total previo = no pudo ser cierre
  const dir = candidate.intent === "bullish" ? "alcista" : candidate.intent === "bearish" ? "bajista" : "neutral";
  let verdict: OiVerdict;
  let label: string;
  let note: string;
  if (confirmedPct >= 0.5) {
    verdict = "confirmed";
    label = "✅ cuajó";
    note = `El OI subió ${deltaOi.toLocaleString()} (${Math.round(confirmedPct * 100)}% del tamaño) → posición ${dir} REAL y nueva. Señal válida.`;
  } else if (confirmedPct >= 0.2) {
    verdict = "partial";
    label = "◑ parcial";
    note = `El OI subió solo ${deltaOi.toLocaleString()} (${Math.round(confirmedPct * 100)}% del tamaño) → cuajó en parte; parte fue cierre/cross. Lee con cautela.`;
  } else {
    verdict = "not_confirmed";
    label = "❌ no cuajó";
    note = `El OI ${deltaOi >= 0 ? "casi no cambió" : "BAJÓ"} (${deltaOi.toLocaleString()}, ${Math.round(confirmedPct * 100)}% del tamaño)${impossibleClose ? " y el print superaba el OI total previo — imposible que fuera cierre normal" : ""} → NO creó posición. Fue cierre/roll/cross. SEÑAL FALSA, descártala.`;
  }
  return { candidate, currentOi, deltaOi, confirmedPct, verdict, label, note };
}
