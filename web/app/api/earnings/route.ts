// GET /api/earnings?ticker=XXX — Earnings IV-Crush: compara el move IMPLÍCITO (straddle
// ATM del próximo vencimiento) contra el move HISTÓRICO de earnings, y devuelve el veredicto
// de "IV rica / justa / barata". Ver docs/superpowers/specs/2026-07-27-earnings-iv-crush-design.md

import {
  fetchCompany,
  fetchDailyBars,
  fetchAtmStraddle,
  fetchEarningsDates,
} from "@/lib/massive";
import {
  impliedEarningsMove,
  historicalEarningsMoves,
  earningsRichness,
} from "@/lib/earningsMove";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) return Response.json({ error: "Falta el ticker." }, { status: 400 });

  try {
    const [company, bars, dates] = await Promise.all([
      fetchCompany(ticker).catch(() => null),
      fetchDailyBars(ticker, 900).catch(() => []), // ~2.5 años → varios earnings
      fetchEarningsDates(ticker).catch(() => []),
    ]);

    const spot = company?.price ?? null;
    const straddle = spot ? await fetchAtmStraddle(ticker, spot).catch(() => null) : null;

    const implied = straddle
      ? impliedEarningsMove({
          spot: straddle.spot ?? spot ?? 0,
          callPrice: straddle.callPrice ?? undefined,
          putPrice: straddle.putPrice ?? undefined,
        })
      : null;

    const hist = historicalEarningsMoves(bars, dates);
    const richness = earningsRichness(implied?.impliedMovePct ?? null, hist);

    return Response.json({
      ...richness,
      moves: hist.moves,
      spot,
      method: implied?.method ?? null,
      straddle: straddle
        ? { strike: straddle.strike, expiration: straddle.expiration, dte: straddle.dte }
        : null,
    });
  } catch {
    return Response.json(
      { error: "No se pudo calcular el earnings move." },
      { status: 502 },
    );
  }
}
