// GET /api/spx-trades — bitácora de credit spreads SPX del usuario.
// POST /api/spx-trades — guarda un trade (con la foto del GEX/flujo del momento).
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { loadSpxTrades, saveSpxTrade, type SpxTrade } from "@/lib/spxTradeStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ trades: await loadSpxTrades() });
  } catch {
    return Response.json({ error: "No se pudo leer la bitácora." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Partial<SpxTrade>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }
  if (
    (body.kind !== "bull_put" && body.kind !== "bear_call") ||
    typeof body.shortStrike !== "number" ||
    typeof body.longStrike !== "number"
  ) {
    return Response.json({ error: "Faltan campos del trade (kind/shortStrike/longStrike)." }, { status: 400 });
  }
  const trade: SpxTrade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    dte: body.dte === 1 ? 1 : 0,
    kind: body.kind,
    shortStrike: body.shortStrike,
    longStrike: body.longStrike,
    width: body.width ?? Math.abs(body.shortStrike - body.longStrike),
    credit: body.credit ?? 0,
    expiration: body.expiration ?? null,
    spotAtEntry: body.spotAtEntry ?? null,
    atmIvAtEntry: body.atmIvAtEntry ?? null,
    regimeAtEntry: body.regimeAtEntry ?? null,
    wallAtEntry: body.wallAtEntry ?? null,
    flowLeanAtEntry: body.flowLeanAtEntry ?? null,
    probOTM: body.probOTM ?? null,
    evMargin: body.evMargin ?? null,
    note: body.note,
  };
  try {
    return Response.json({ trades: await saveSpxTrade(trade) });
  } catch {
    return Response.json({ error: "No se pudo guardar el trade." }, { status: 500 });
  }
}
