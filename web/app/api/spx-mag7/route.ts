// GET /api/spx-mag7 — monitor de las 7 Magníficas como termómetro de a dónde va el mercado.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { spxMag7 } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await spxMag7());
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer las Mag 7.";
    return Response.json({ error: message }, { status: 502 });
  }
}
