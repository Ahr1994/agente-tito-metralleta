// Orquesta la confirmación de OI para CUALQUIER ticker: detecta los candidatos de apertura de hoy
// (los guarda para confirmar mañana) y confirma los de la sesión anterior contra el OI de hoy.
// El OI de confirmación (T+1) sale del campo `oi` del flujo de hoy (= cierre de AYER, ya con el
// print incluido); si el contrato no operó hoy, cae a la cadena. Solo servidor. Ver lib/oiConfirm.ts.

import { fetchFlow, fetchSpxChainMs } from "./marketsnack";
import { parseOcc, marketDateStr } from "./occ";
import {
  detectOpeningCandidates,
  confirmOpening,
  type FlowPrint,
  type OpeningCandidate,
  type OiConfirmation,
} from "./oiConfirm";
import { loadOiWatch, saveOiWatch, priorOiSession } from "./oiWatchStore";

export interface OiConfirmResult {
  ticker: string;
  todayCandidates: OpeningCandidate[]; // detectados hoy (a confirmar mañana)
  priorDate: string | null; // sesión que se está confirmando
  confirmations: OiConfirmation[]; // candidatos de ayer vs el OI de hoy
  flowError: string | null;
  generatedAt: string;
}

const contractKey = (strike: number, type: string, exp: string) => `${strike}|${type}|${exp}`;

export async function oiConfirmScan(
  ticker: string,
  opts: { minPremium?: number } = {},
  now: Date = new Date(),
): Promise<OiConfirmResult> {
  const T = ticker.toUpperCase();
  const date = marketDateStr(now);
  let flowError: string | null = null;

  // Flujo de hoy con piso bajo: sirve para (a) detectar candidatos y (b) construir el mapa de OI
  // de confirmación (el `oi` de hoy = EOD de ayer).
  const prints: FlowPrint[] = [];
  const todayOi = new Map<string, number>();
  try {
    const flow = await fetchFlow(T, { period: "1d", maxPages: 25, minPremium: 25_000 });
    for (const t of flow.trades as any[]) {
      const o = parseOcc(t.symbol);
      if (!o) continue;
      const fp: FlowPrint = {
        strike: o.strike,
        type: o.type,
        expiration: o.expiration,
        rawSide: t.side ?? "",
        size: t.size ?? 0,
        premium: t.premium ?? 0,
        oi: t.open_interest ?? 0,
        timestamp: t.timestamp ?? "",
        delta: t.delta ?? null,
      };
      prints.push(fp);
      const k = contractKey(o.strike, o.type, o.expiration);
      todayOi.set(k, Math.max(todayOi.get(k) ?? 0, fp.oi));
    }
  } catch (e) {
    flowError = e instanceof Error ? e.message : "No se pudo leer el flujo.";
  }

  // top 20 por premium: mantiene enfocada la confirmación de mañana en los prints que importan
  const todayCandidates = detectOpeningCandidates(prints, { minPremium: opts.minPremium ?? 500_000 }).slice(0, 20);
  if (todayCandidates.length) {
    await saveOiWatch(T, { date, detectedAt: now.toISOString(), candidates: todayCandidates });
  }

  // Confirmar la sesión anterior contra el OI de hoy
  const sessions = await loadOiWatch(T);
  const prior = priorOiSession(sessions, date);
  const confirmations: OiConfirmation[] = [];
  if (prior && prior.candidates.length) {
    // cadena como respaldo si el contrato no operó hoy
    let chainOi: Map<string, number> | null = null;
    const needChain = prior.candidates.some((c) => !todayOi.has(contractKey(c.strike, c.type, c.expiration)));
    if (needChain) {
      try {
        const chain = await fetchSpxChainMs(T, 20);
        chainOi = new Map();
        for (const q of chain?.quotes ?? []) chainOi.set(contractKey(q.strike, q.type, q.expiration), q.oi ?? 0);
      } catch {
        /* respaldo opcional */
      }
    }
    for (const c of prior.candidates) {
      const k = contractKey(c.strike, c.type, c.expiration);
      const oi = todayOi.get(k) ?? chainOi?.get(k) ?? null;
      confirmations.push(confirmOpening(c, oi));
    }
    confirmations.sort((a, b) => b.candidate.premium - a.candidate.premium);
  }

  return {
    ticker: T,
    todayCandidates,
    priorDate: prior?.date ?? null,
    confirmations,
    flowError,
    generatedAt: now.toISOString(),
  };
}
