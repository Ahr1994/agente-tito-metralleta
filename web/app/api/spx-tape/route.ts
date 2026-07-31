// GET /api/spx-tape — tape institucional del SPX (prints grandes que alimentan la foto de
// gamma), como la de la vista GEX de MarketSnack. ?min=100000 ajusta el umbral.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { spxInstitutionalTape } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minPremium = Number(searchParams.get("min")) || undefined;
  try {
    return Response.json(await spxInstitutionalTape({ minPremium }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer la tape institucional.";
    return Response.json({ error: message }, { status: 502 });
  }
}
