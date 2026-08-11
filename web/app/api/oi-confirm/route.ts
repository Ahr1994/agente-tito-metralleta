// GET /api/oi-confirm?ticker=XXX — confirma si los prints grandes de "apertura" de la sesión
// anterior realmente crearon posición (OI subió) o fueron cierre/roll/cross (señal falsa).
// Ver lib/oiConfirm.ts. Nació del caso WULF.

import { oiConfirmScan } from "@/lib/oiConfirmServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") || "").trim();
    if (!ticker) return Response.json({ error: "Falta ?ticker=" }, { status: 400 });
    const min = Number(url.searchParams.get("min"));
    const minPremium = Number.isFinite(min) && min > 0 ? min : undefined;
    return Response.json(await oiConfirmScan(ticker, { minPremium }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo confirmar el OI.";
    return Response.json({ error: message }, { status: 502 });
  }
}
