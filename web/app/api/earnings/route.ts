// GET /api/earnings?ticker=XXX — Earnings IV-Crush: compara el move IMPLÍCITO (straddle
// ATM del próximo vencimiento) contra el move HISTÓRICO de earnings, devuelve el veredicto
// de "IV rica / justa / barata" y sugiere spreads de crédito.
// Ver docs/superpowers/specs/2026-07-27-earnings-iv-crush-design.md

import { fetchCompany, fetchDailyBars, fetchChainQuotes, fetchEarningsDates } from "@/lib/massive";
import {
  impliedEarningsMove,
  historicalEarningsMoves,
  earningsRichness,
  atmStraddle,
} from "@/lib/earningsMove";
import { suggestCreditSpreads, type OptionQuote } from "@/lib/premiumSell";

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
    const chain = spot ? await fetchChainQuotes(ticker, spot).catch(() => null) : null;
    const s = chain?.spot ?? spot ?? 0;

    const straddle = chain ? atmStraddle(chain.quotes, s) : null;
    const implied = straddle
      ? impliedEarningsMove({ spot: s, callPrice: straddle.callPrice, putPrice: straddle.putPrice })
      : null;

    const hist = historicalEarningsMoves(bars, dates);
    const richness = earningsRichness(implied?.impliedMovePct ?? null, hist);

    // Sugeridor de spreads (sin muros por ahora; delta + fuera de 1σ). Ancho ≈ 2.5% del spot.
    let spreads = null;
    if (chain && implied && s > 0) {
      const quotes: OptionQuote[] = chain.quotes
        .filter((q) => q.delta != null)
        .map((q) => ({ strike: q.strike, type: q.type, price: q.price, delta: q.delta!, oi: q.oi }));
      const width = Math.max(1, Math.round(s * 0.025));
      spreads = suggestCreditSpreads(
        quotes,
        s,
        { supports: [], resistances: [] },
        implied.impliedMovePct,
        { targetDelta: 0.2, width },
      );
    }

    return Response.json({
      ...richness,
      moves: hist.moves,
      spot: s || null,
      method: implied?.method ?? null,
      straddle: chain && straddle
        ? { strike: straddle.strike, expiration: chain.expiration, dte: chain.dte }
        : null,
      spreads,
    });
  } catch {
    return Response.json({ error: "No se pudo calcular el earnings move." }, { status: 502 });
  }
}
