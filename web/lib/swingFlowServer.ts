// Orquesta el mapa de flujo multi-expiración para cualquier ticker (swing/direccional): trae el
// flujo de 5d de TODAS las expiraciones y lo pasa por swingFlowMap para detectar divergencias
// (techos con timing) ANTES de recomendar. Solo servidor. Ver lib/swingFlow.ts.

import { fetchFlow, fetchSpxIndex } from "./marketsnack";
import { parseOcc } from "./occ";
import { swingFlowMap, type SwingPrint, type SwingFlowMap } from "./swingFlow";

export interface SwingFlowResult {
  ticker: string;
  spot: number;
  map: SwingFlowMap;
  flowError: string | null;
  generatedAt: string;
}

export async function swingFlow(
  ticker: string,
  opts: { minDte?: number; maxDte?: number; minPremium?: number } = {},
  now: Date = new Date(),
): Promise<SwingFlowResult> {
  const T = ticker.toUpperCase();
  const px = await fetchSpxIndex(T).catch(() => null);
  let spot = px?.price ?? 0;
  let flowError: string | null = null;
  const prints: SwingPrint[] = [];
  try {
    const flow = await fetchFlow(T, { period: "5d", maxPages: 15, minPremium: 150_000 });
    for (const t of flow.trades as any[]) {
      const o = parseOcc(t.symbol);
      if (!o) continue;
      if (!(spot > 0) && (t.asset_price ?? 0) > 0) spot = t.asset_price;
      prints.push({
        strike: o.strike, type: o.type, expiration: o.expiration,
        rawSide: t.side ?? "", premium: t.premium ?? 0, size: t.size ?? 0,
        oi: t.open_interest ?? 0, delta: t.delta ?? null,
        spot: t.asset_price ?? spot, price: t.price ?? 0,
      });
    }
  } catch (e) {
    flowError = e instanceof Error ? e.message : "No se pudo leer el flujo.";
  }
  return { ticker: T, spot, map: swingFlowMap(prints, now, opts), flowError, generatedAt: now.toISOString() };
}
