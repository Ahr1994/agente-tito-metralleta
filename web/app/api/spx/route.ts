// GET /api/spx — análisis SPX 0DTE/1DTE (GEX + extremos safe + IV Rank + flujo + noticias).
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { computeSpx } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const width = Number(searchParams.get("width")) || undefined;
  try {
    const result = await computeSpx({ width });
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo analizar el SPX.";
    return Response.json({ error: message }, { status: 502 });
  }
}
