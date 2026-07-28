// Orquestación server-side del cómputo de Earnings IV-Crush para UN ticker.
// Reusado por /api/earnings (drill-down, con spreads) y /api/earnings-scan (escáner).
// Ver docs/superpowers/specs/2026-07-27-earnings-iv-crush-design.md

import { fetchCompany, fetchDailyBars, fetchChainQuotes, fetchEarningsDates } from "./massive";
import {
  impliedEarningsMove,
  historicalEarningsMoves,
  earningsRichness,
  atmStraddle,
  type Richness,
} from "./earningsMove";
import { suggestCreditSpreads, type OptionQuote, type Spread } from "./premiumSell";
import { estimateNextEarnings } from "./earnings";

export interface EarningsResult extends Richness {
  ticker: string;
  spot: number | null;
  method: "straddle" | "iv" | null;
  straddle: { strike: number; expiration: string; dte: number } | null;
  spreads: { putSpread: Spread | null; callSpread: Spread | null } | null;
  moves: number[];
  /** fecha estimada del próximo earnings (proxy por cadencia de filing), o null. */
  nextEarnings: string | null;
}

export async function computeEarnings(
  ticker: string,
  opts: { withSpreads?: boolean } = {},
): Promise<EarningsResult> {
  const clean = ticker.trim().toUpperCase();

  const [company, bars, dates] = await Promise.all([
    fetchCompany(clean).catch(() => null),
    fetchDailyBars(clean, 900).catch(() => []),
    fetchEarningsDates(clean).catch(() => []),
  ]);

  const spot0 = company?.price ?? null;
  const chain = spot0 ? await fetchChainQuotes(clean, spot0).catch(() => null) : null;
  const s = chain?.spot ?? spot0 ?? 0;

  const straddle = chain ? atmStraddle(chain.quotes, s) : null;
  const implied = straddle
    ? impliedEarningsMove({ spot: s, callPrice: straddle.callPrice, putPrice: straddle.putPrice })
    : null;

  const hist = historicalEarningsMoves(bars, dates);
  const richness = earningsRichness(implied?.impliedMovePct ?? null, hist);
  const nextEarnings = estimateNextEarnings(dates, new Date());

  let spreads: EarningsResult["spreads"] = null;
  if (opts.withSpreads && chain && implied && s > 0) {
    const quotes: OptionQuote[] = chain.quotes
      .filter((q) => q.delta != null)
      .map((q) => ({ strike: q.strike, type: q.type, price: q.price, delta: q.delta!, oi: q.oi }));
    const width = Math.max(1, Math.round(s * 0.025));
    const r = suggestCreditSpreads(
      quotes,
      s,
      { supports: [], resistances: [] },
      implied.impliedMovePct,
      { targetDelta: 0.2, width },
    );
    spreads = { putSpread: r.putSpread, callSpread: r.callSpread };
  }

  return {
    ticker: clean,
    ...richness,
    moves: hist.moves,
    spot: s || null,
    method: implied?.method ?? null,
    straddle:
      chain && straddle
        ? { strike: straddle.strike, expiration: chain.expiration, dte: chain.dte }
        : null,
    spreads,
    nextEarnings,
  };
}
