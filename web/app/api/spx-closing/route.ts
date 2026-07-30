// GET /api/spx-closing — ventas de prima grandes en el cierre (power hour) para el día
// siguiente, y confirmación contra el OI. ?min=250000 ajusta el umbral.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { spxClosingFlow } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minPremium = Number(searchParams.get("min")) || undefined;
  try {
    return Response.json(await spxClosingFlow({ minPremium }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer el flujo de cierre.";
    return Response.json({ error: message }, { status: 502 });
  }
}
