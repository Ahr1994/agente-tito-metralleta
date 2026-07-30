// GET /api/spx-review — track record real de los spreads SPX guardados (win-rate, EV realizado,
// edge vs ProbOTM), evaluados contra el settlement (SPY×10).
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { reviewSpxTrades } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await reviewSpxTrades());
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo evaluar la bitácora.";
    return Response.json({ error: message }, { status: 502 });
  }
}
