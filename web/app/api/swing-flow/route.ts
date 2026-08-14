// GET /api/swing-flow?ticker=X — mapa de flujo MULTI-EXPIRACIÓN para swing: netea compra/venta de
// calls y puts por strike+expiración (near → ≥3 meses) y detecta DIVERGENCIAS (techos con timing)
// antes de recomendar. ?minDte= ?maxDte= opcionales.

import { swingFlow } from "@/lib/swingFlowServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = url.searchParams.get("ticker");
    if (!ticker) return Response.json({ error: "Falta ?ticker=" }, { status: 400 });
    const minDte = Number(url.searchParams.get("minDte"));
    const maxDte = Number(url.searchParams.get("maxDte"));
    return Response.json(
      await swingFlow(ticker, {
        minDte: Number.isFinite(minDte) && minDte >= 0 ? minDte : undefined,
        maxDte: Number.isFinite(maxDte) && maxDte > 0 ? maxDte : undefined,
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer el flujo de swing.";
    return Response.json({ error: message }, { status: 502 });
  }
}
