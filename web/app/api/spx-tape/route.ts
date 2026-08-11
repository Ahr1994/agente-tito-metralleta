// GET /api/spx-tape — lector de tape con ESTRUCTURA + captura continua. Clasifica sintéticos/
// verticales/straddles y separa el flujo LIMPIO del ESTRUCTURAL para no leer mal un deep-ITM.
// ?min=<premium mínimo del titular> (default 250000)
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { spxTapeRead } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const min = Number(url.searchParams.get("min"));
    const minPremium = Number.isFinite(min) && min > 0 ? min : undefined;
    return Response.json(await spxTapeRead({ minPremium }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer el tape.";
    return Response.json({ error: message }, { status: 502 });
  }
}
