// GET /api/spx-momentum — módulo direccional de cierre: señal de move agresivo (long/short +
// target) cruzando GEX oficial + flujo agresivo, en las últimas 2h.
// Ver docs/superpowers/specs/2026-08-03-spx-momentum-cierre-design.md

import { spxMomentum } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await spxMomentum());
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo calcular el momentum de cierre.";
    return Response.json({ error: message }, { status: 502 });
  }
}
