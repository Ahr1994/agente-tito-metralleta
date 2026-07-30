// GET /api/spx-monitor — monitor en vivo de tus spreads abiertos: ¿aguantar o salir?
// Pensado para pollear cada ~minuto durante la sesión.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { spxMonitor } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await spxMonitor());
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo monitorear las posiciones.";
    return Response.json({ error: message }, { status: 502 });
  }
}
