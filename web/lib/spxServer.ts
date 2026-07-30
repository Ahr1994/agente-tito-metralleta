// Orquestación del módulo SPX 0DTE/1DTE: junta cadena + flujo + GEX + extremos safe + IV Rank
// + noticias macro para las dos expiraciones. Solo servidor.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { fetchSpxChain } from "./massive";
import { fetchSpxFlow } from "./marketsnack";
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

export async function computeSpx(opts: { width?: number } = {}): Promise<SpxAnalysis> {
  const now = new Date();
  const width = opts.width ?? 5;

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
    const setup = spxSafeExtremes(set, spot, gex, bias, { width });
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
