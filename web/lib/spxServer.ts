// Orquestación del módulo SPX 0DTE/1DTE: junta cadena + flujo + GEX + extremos safe + IV Rank
// + noticias macro para las dos expiraciones. Solo servidor.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { fetchSpxChain, fetchDailyBars } from "./massive";
import { fetchSpxFlow } from "./marketsnack";
import { marketDateStr } from "./occ";
import { loadSpxTrades } from "./spxTradeStore";
import { reviewSpxTrade, summarizeSpxTrades, type SpxTradeReview, type SpxTrackRecord } from "./spxReview";
import {
  deriveSpxSpot,
  splitByDte,
  spxGex,
  flowBias,
  atmIvSpx,
  spxSafeExtremes,
  type SpxSafeSetup,
} from "./spx";
import { fetchMacroFeeds, type NewsItem } from "./news";
import { loadSpxIv, saveSpxIv, spxIvRank, type SpxIvRank } from "./spxIvStore";

export interface SpxDteSetup {
  dte: 0 | 1;
  expiration: string | null;
  contracts: number;
  setup: SpxSafeSetup;
}

export interface SpxAnalysis {
  spot: number | null;
  spotDerived: true; // el índice da 403 → siempre derivado por paridad
  ivRank: SpxIvRank;
  atmIv: number | null; // decimal
  zero: SpxDteSetup | null;
  one: SpxDteSetup | null;
  news: NewsItem[];
  flowError: string | null;
  generatedAt: string;
}

export async function computeSpx(
  opts: { width?: number; maxDelta?: number; credit?: { min: number; max: number } } = {},
): Promise<SpxAnalysis> {
  const now = new Date();
  const width = opts.width ?? 5;
  const maxDelta = opts.maxDelta;
  const credit = opts.credit;

  const { quotes } = await fetchSpxChain();
  const spot = deriveSpxSpot(quotes);
  const { zeroDte, oneDte, zeroExp, oneExp } = splitByDte(quotes, now);

  // Flujo (puede fallar si la cookie caducó — no bloquea el resto).
  let flowTrades: Awaited<ReturnType<typeof fetchSpxFlow>>["trades"] = [];
  let flowError: string | null = null;
  try {
    flowTrades = (await fetchSpxFlow()).trades;
  } catch (e) {
    flowError = e instanceof Error ? e.message : "No se pudo leer el flujo de MarketSnack.";
  }

  // IV Rank (proxy acumulado) + noticias macro, en paralelo.
  const front = zeroDte.length ? zeroDte : oneDte;
  const atmIv = spot ? atmIvSpx(front, spot) : null;
  const [ivHistory, news] = await Promise.all([
    loadSpxIv(),
    fetchMacroFeeds().catch(() => [] as NewsItem[]),
  ]);
  const ivRank = spxIvRank(ivHistory, atmIv);
  if (atmIv) void saveSpxIv(atmIv, now); // acumula para el próximo día (fire-and-forget)

  const build = (set: typeof zeroDte, exp: string | null, dte: 0 | 1): SpxDteSetup | null => {
    if (!spot || set.length === 0) return null;
    const gex = spxGex(set, spot);
    const bias = flowBias(flowTrades.filter((t) => t.expiration === exp));
    const setup = spxSafeExtremes(set, spot, gex, bias, { width, maxDelta, credit });
    return { dte, expiration: exp, contracts: set.length, setup };
  };

  return {
    spot,
    spotDerived: true,
    ivRank,
    atmIv,
    zero: build(zeroDte, zeroExp, 0),
    one: build(oneDte, oneExp, 1),
    news: news.slice(0, 6),
    flowError,
    generatedAt: now.toISOString(),
  };
}

export interface SpxReviewResult {
  reviews: SpxTradeReview[]; // más reciente primero
  record: SpxTrackRecord;
  settlementNote: string;
}

/**
 * Track record real: evalúa cada spread guardado contra el settlement (SPX derivado del cierre
 * = SPY×10, el índice da 403). Solo evalúa los ya vencidos (expiración < hoy); el resto queda
 * pending. Devuelve los reviews + el resumen (win-rate, EV realizado, edge vs ProbOTM).
 */
export async function reviewSpxTrades(now: Date = new Date()): Promise<SpxReviewResult> {
  const trades = await loadSpxTrades();
  const today = marketDateStr(now);
  const bars = await fetchDailyBars("SPY", 120).catch(() => []);
  const closeByDate = new Map(bars.map((b) => [b.time, b.close * 10])); // SPY×10 ≈ SPX

  const reviews = trades.map((t) => {
    const settled =
      t.expiration && t.expiration < today ? (closeByDate.get(t.expiration) ?? null) : null;
    return reviewSpxTrade(t, settled);
  });

  return {
    reviews,
    record: summarizeSpxTrades(reviews),
    settlementNote: "Settlement estimado con SPY×10 (el índice SPX requiere plan Indices).",
  };
}
