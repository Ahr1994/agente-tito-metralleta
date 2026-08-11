// GET /api/spx-premium-sells — DÓNDE venden prima 0DTE/1DTE (neto por strike, piso bajo para cazar
// el flujo 0DTE). Puts vendidos = soporte, calls vendidos = resistencia, puts comprados = defensivo.
// ?maxDte=<días> (default 1 = 0-1DTE)

import { spxPremiumSells } from "@/lib/spxServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const dte = Number(url.searchParams.get("maxDte"));
    const maxDte = Number.isFinite(dte) && dte >= 0 ? dte : undefined;
    return Response.json(await spxPremiumSells({ maxDte }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo escanear la venta de prima.";
    return Response.json({ error: message }, { status: 502 });
  }
}
