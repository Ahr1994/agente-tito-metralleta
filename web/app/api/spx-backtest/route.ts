// GET /api/spx-backtest — ¿el precio respeta los muros de GEX? (idea #5)
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { backtestSpxWalls } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await backtestSpxWalls());
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo correr el backtest.";
    return Response.json({ error: message }, { status: 502 });
  }
}
