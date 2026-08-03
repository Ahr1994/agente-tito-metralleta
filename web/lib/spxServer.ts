// Orquestación del módulo SPX 0DTE/1DTE: junta cadena + flujo + GEX + extremos safe + IV Rank
// + noticias macro para las dos expiraciones. Solo servidor.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { fetchSpxChain, fetchDailyBars, fetchCompany, fetchStockChanges } from "./massive";
import { mag7Breadth, MAG7, type Mag7Breadth } from "./mag7";
import {
  fetchSpxFlow,
  fetchSpxIndex,
  fetchSpxMsGex,
  fetchSpxSentiment,
  fetchSpxChainMs,
  type MsGexSnapshot,
} from "./marketsnack";
import type { SpxDaySentiment } from "./spx";
import { marketDateStr } from "./occ";
import { loadSpxTrades, type SpxTrade } from "./spxTradeStore";
import { reviewSpxTrade, summarizeSpxTrades, type SpxTradeReview, type SpxTrackRecord } from "./spxReview";
import {
  deriveSpxSpot,
  splitByDte,
  spxGex,
  flowBias,
  atmIvSpx,
  spxSafeExtremes,
  spxFreshness,
  spxEdgeSignal,
  spxDailySigmaPct,
  realtimeSpotFromFlow,
  spotFromFlowParity,
  type SpxSafeSetup,
  type SpxFreshness,
  type SpxEdgeSignal,
} from "./spx";
import { fetchMacroFeeds, type NewsItem } from "./news";
import { loadSpxIv, saveSpxIv, spxIvRank, type SpxIvRank } from "./spxIvStore";
import { saveSpxGexSnapshot, loadSpxGexHistory } from "./spxGexStore";
import { backtestWalls, type WallBacktest, type DayRange } from "./spxWallBacktest";
import {
  detectClosingSells,
  reviewClosingSells,
  contractKey,
  inClosingWindow,
  type ClosingSell,
  type ClosingSellReview,
} from "./closingFlow";
import { loadCloseFlow, saveCloseFlow, priorSession } from "./spxCloseFlowStore";
import { monitorPosition, type PositionStatus, type PositionMarket } from "./positionMonitor";
import { institutionalTape, type InstitutionalTape } from "./institutionalTape";

export interface SpxDteSetup {
  dte: 0 | 1;
  expiration: string | null;
  contracts: number;
  setup: SpxSafeSetup;
}

export interface SpxAnalysis {
  spot: number | null;
  spotSource: "index" | "derived"; // index = MarketSnack tiempo real (plan Indices) · derived = paridad
  indexDelayed: boolean; // true si MarketSnack marca el precio como retrasado
  msGex: MsGexSnapshot | null; // GEX oficial de MarketSnack (muros, max pain, flip)
  daySentiment: SpxDaySentiment | null; // sentiment del día (premium calls/puts comprado/vendido)
  chainSource: "marketsnack" | "massive"; // fuente de la cadena (IV/greeks reales vs Massive)
  ivRank: SpxIvRank;
  atmIv: number | null; // decimal
  freshness: SpxFreshness; // idea #3: data stale
  edge: SpxEdgeSignal; // idea #2: ¿hoy hay edge?
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

  // Cadena PRIMARIA de MarketSnack (IV/greeks reales + bid/ask, misma fuente que índice/GEX);
  // si falla, cae a la de Massive (I:SPX).
  const msChain = await fetchSpxChainMs();
  const { quotes } = msChain ?? (await fetchSpxChain());
  const chainSource: "marketsnack" | "massive" = msChain ? "marketsnack" : "massive";
  const { zeroDte, oneDte, zeroExp, oneExp } = splitByDte(quotes, now);

  // Spot en TIEMPO REAL de MarketSnack (plan Indices) + su GEX oficial + sentiment del día.
  const [index, msGex, daySentiment, spy] = await Promise.all([
    fetchSpxIndex(),
    fetchSpxMsGex(),
    fetchSpxSentiment().catch(() => null),
    fetchCompany("SPY").catch(() => null),
  ]);
  const derivedSpot = deriveSpxSpot(quotes);
  const spot = index?.price ?? derivedSpot;
  const spotSource: "index" | "derived" = index?.price != null ? "index" : "derived";
  const refSpot = spy?.price && spy.price > 0 ? spy.price * 10 : null;

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

  const zero = build(zeroDte, zeroExp, 0);
  const one = build(oneDte, oneExp, 1);

  // Frescura de la data (idea #3): mercado abierto + divergencia spot derivado vs SPY×10.
  const freshness = spxFreshness(spot, refSpot, now);

  // Foto de muros del 0DTE para el backtest (idea #5), y señal de edge (idea #2).
  const frontSetup = zero ?? one;
  if (frontSetup && spot) {
    const g = frontSetup.setup.gex;
    void saveSpxGexSnapshot({ spot, putWall: g.putWall, callWall: g.callWall, magnet: g.magnet, regime: g.regime }, now);
  }
  const bestEvMargin = frontSetup
    ? frontSetup.setup.extremes.reduce<number | null>(
        (best, e) => (best == null || e.evMargin > best ? e.evMargin : best),
        null,
      )
    : null;
  const edge = spxEdgeSignal({
    ivRankValue: ivRank.value,
    atmIv,
    regime: frontSetup?.setup.gex.regime ?? "positive",
    bestEvMargin,
    stale: freshness.stale,
  });

  return {
    spot,
    spotSource,
    indexDelayed: index?.delayed ?? false,
    msGex,
    daySentiment,
    chainSource,
    ivRank,
    atmIv,
    freshness,
    edge,
    zero,
    one,
    news: news.slice(0, 6),
    flowError,
    generatedAt: now.toISOString(),
  };
}

export interface SpxClosingFlowResult {
  today: ClosingSell[]; // ventas de prima detectadas hoy en el power hour
  detectedInWindow: boolean; // hubo trades en la ventana de cierre (ya estamos en/pasado el cierre)
  prior: { date: string; reviews: ClosingSellReview[] } | null; // sesión anterior confirmada vs OI de hoy
  note: string;
}

/**
 * Ventas de prima grandes en el cierre (power hour, 15:30–16:00 ET) para el vencimiento
 * cercano, y confirmación al día siguiente contra el OI. Detecta hoy + guarda; y cruza la
 * sesión anterior guardada con el OI actual de la cadena. Umbral configurable.
 */
export async function spxClosingFlow(
  opts: { minPremium?: number } = {},
  now: Date = new Date(),
): Promise<SpxClosingFlowResult> {
  const today = marketDateStr(now);

  // Flujo de hoy → ventas del power hour.
  let flowTrades: Awaited<ReturnType<typeof fetchSpxFlow>>["trades"] = [];
  try {
    flowTrades = (await fetchSpxFlow()).trades;
  } catch {
    /* cookie caducada → seguimos con lo guardado */
  }
  const todaySells = detectClosingSells(flowTrades, now, { minPremium: opts.minPremium });
  const detectedInWindow = flowTrades.some((t) => inClosingWindow(Date.parse(t.timestamp)));
  if (detectedInWindow && todaySells.length > 0) {
    void saveCloseFlow({ date: today, detectedAt: now.toISOString(), sells: todaySells });
  }

  // Confirmación de la sesión anterior contra el OI de la cadena de hoy.
  const history = await loadCloseFlow();
  const previous = priorSession(history, today);
  let prior: SpxClosingFlowResult["prior"] = null;
  if (previous) {
    const { quotes } = await fetchSpxChain().catch(() => ({ quotes: [] as Awaited<ReturnType<typeof fetchSpxChain>>["quotes"] }));
    const oiMap = new Map(quotes.map((q) => [contractKey({ type: q.type, strike: q.strike, expiration: q.expiration }), q.oi]));
    prior = { date: previous.date, reviews: reviewClosingSells(previous.sells, oiMap) };
  }

  return {
    today: todaySells,
    detectedInWindow,
    prior,
    note: "Ventas agresivas (al bid) del vencimiento cercano en los últimos 30 min. La confirmación compara el OI de hoy contra el de la venta (EOD previo); si subió ≈ lo vendido, se abrió y quedó overnight.",
  };
}

export interface SpxWallBacktestResult extends WallBacktest {
  note: string;
}

/**
 * Backtest de la tesis del muro (idea #5): cruza las fotos diarias de muros con el rango real
 * de cada día (SPY×10) → ¿el precio respetó los muros? Necesita días acumulados en el store.
 */
export async function backtestSpxWalls(now: Date = new Date()): Promise<SpxWallBacktestResult> {
  const [snapshots, bars] = await Promise.all([
    loadSpxGexHistory(),
    fetchDailyBars("SPY", 200).catch(() => []),
  ]);
  const today = marketDateStr(now);
  const ranges: DayRange[] = bars
    .filter((b) => b.time < today) // solo días ya cerrados
    .map((b) => ({ date: b.time, high: b.high * 10, low: b.low * 10, close: b.close * 10 }));
  return {
    ...backtestWalls(snapshots, ranges),
    note: "Muros vs rango del día (SPY×10). Los muros se guardan 1×/día, así que es una aproximación intradía; el valor crece al acumular sesiones.",
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

export interface SpxMonitorPosition {
  trade: SpxTrade;
  spot: number | null;
  status: PositionStatus;
}

export interface SpxMonitorResult {
  positions: SpxMonitorPosition[]; // tus spreads guardados que aún no vencen
  spot: number | null;
  spotSource: "index" | "tape" | "parity" | "derived"; // index/tape/parity = tiempo real · derived = retrasado
  generatedAt: string;
  note: string;
}

/**
 * Monitor en vivo de las posiciones abiertas (spreads guardados con expiración ≥ hoy). Para
 * cada una arma el mercado actual (spot, delta/mark del short, flujo agresivo en contra, muro
 * que defiende, σ del día) y pide la recomendación aguantar/vigilar/cerrar/salir. Pensado para
 * pollear cada ~minuto durante la sesión.
 */
export async function spxMonitor(now: Date = new Date()): Promise<SpxMonitorResult> {
  const today = marketDateStr(now);
  const open = (await loadSpxTrades()).filter((t) => t.expiration && t.expiration >= today);
  if (open.length === 0) {
    return { positions: [], spot: null, spotSource: "derived", generatedAt: now.toISOString(), note: "Sin posiciones abiertas. Guarda un spread con ⭐ para monitorearlo." };
  }

  const [{ quotes }, index] = await Promise.all([fetchSpxChain(), fetchSpxIndex()]);
  const derivedSpot = deriveSpxSpot(quotes);
  let flowTrades: Awaited<ReturnType<typeof fetchSpxFlow>>["trades"] = [];
  try {
    flowTrades = (await fetchSpxFlow({ maxPages: 4 })).trades; // lo reciente (para spot real + flujo)
  } catch {
    /* cookie caducada → seguimos con el spot derivado */
  }

  // Spot en TIEMPO REAL, no el derivado retrasado que daba colchones falsos. Preferencia:
  // (1) índice de MarketSnack (plan Indices, lo más fiable); (2) asset_price de la tape;
  // (3) paridad put-call del flujo; (4) derivado de la cadena. Luego se ajustan los marks de
  // la cadena al spot real por delta (1er orden).
  const indexSpot = index?.price ?? null;
  const tapeSpot = indexSpot == null ? realtimeSpotFromFlow(flowTrades) : null;
  const paritySpot = indexSpot == null && tapeSpot == null ? spotFromFlowParity(flowTrades, now) : null;
  const rtSpot = indexSpot ?? tapeSpot ?? paritySpot;
  const spot = rtSpot ?? derivedSpot;
  const spotSource: "index" | "tape" | "parity" | "derived" =
    indexSpot != null ? "index" : tapeSpot != null ? "tape" : paritySpot != null ? "parity" : "derived";
  const spotGap = rtSpot != null && derivedSpot != null ? rtSpot - derivedSpot : 0;
  const markToReal = (q: { delta: number | null; price: number } | undefined): number | null =>
    q == null ? null : Math.max(0, q.price + (q.delta ?? 0) * spotGap);

  const positions: SpxMonitorPosition[] = open.map((t) => {
    const exp = t.expiration as string;
    const isPut = t.kind === "bull_put";
    const legType = isPut ? "put" : "call";
    const set = quotes.filter((q) => q.expiration === exp);
    const gex = spot ? spxGex(set, spot) : null;
    const iv = spot ? atmIvSpx(set, spot) : null;
    const bias = flowBias(flowTrades.filter((f) => f.expiration === exp));
    const short = set.find((q) => q.strike === t.shortStrike && q.type === legType);
    const long = set.find((q) => q.strike === t.longStrike && q.type === legType);

    const market: PositionMarket = {
      spot: spot ?? 0,
      shortDelta: short?.delta != null ? Math.abs(short.delta) : null,
      shortMark: markToReal(short),
      longMark: markToReal(long),
      adversePremium: isPut ? bias.bearishPremium : bias.bullishPremium,
      favorablePremium: isPut ? bias.bullishPremium : bias.bearishPremium,
      flowLean: bias.lean,
      regime: gex?.regime ?? "positive",
      defendingWall: isPut ? (gex?.putWall ?? null) : (gex?.callWall ?? null),
      sigma1Pct: iv != null ? spxDailySigmaPct(iv) : 0,
    };
    const status = monitorPosition(
      { kind: t.kind, shortStrike: t.shortStrike, longStrike: t.longStrike, credit: t.credit, expiration: exp },
      market,
    );
    return { trade: t, spot, status };
  });

  return {
    positions,
    spot,
    spotSource,
    generatedAt: now.toISOString(),
    note:
      spotSource === "index"
        ? "Spot del índice SPX en TIEMPO REAL (MarketSnack, plan Indices). El P&L es estimado (marks ajustados por delta) — confía en tu broker para el exacto."
        : spotSource === "tape"
          ? "Spot en tiempo real (tape). El P&L es estimado (marks ajustados por delta) — confía en tu broker."
          : spotSource === "parity"
            ? "Spot en tiempo real por paridad del flujo. El P&L es estimado — confía en tu broker."
            : "⚠ Spot derivado (retrasado) — sin flujo en vivo. Confía en tu broker para el precio real.",
  };
}

export interface SpxTapeResult {
  tape: InstitutionalTape;
  minPremium: number;
  flowError: string | null;
  generatedAt: string;
}

/**
 * Tape institucional del SPX (idéntica a la de la vista GEX de MarketSnack): los prints grandes
 * del día. Usa el filtro server-side `minPremium` para traer solo lo institucional en pocas
 * páginas. Pensado para pollear en vivo durante la sesión.
 */
export async function spxInstitutionalTape(
  opts: { minPremium?: number } = {},
  now: Date = new Date(),
): Promise<SpxTapeResult> {
  const minPremium = opts.minPremium ?? 100_000;
  let flowTrades: Awaited<ReturnType<typeof fetchSpxFlow>>["trades"] = [];
  let flowError: string | null = null;
  try {
    flowTrades = (await fetchSpxFlow({ period: "1d", minPremium, maxPages: 12 })).trades;
  } catch (e) {
    flowError = e instanceof Error ? e.message : "No se pudo leer el flujo de MarketSnack.";
  }
  return {
    tape: institutionalTape(flowTrades, { minPremium }),
    minPremium,
    flowError,
    generatedAt: now.toISOString(),
  };
}

export interface SpxMag7Result {
  breadth: Mag7Breadth;
  generatedAt: string;
}

/**
 * Monitor de las 7 Magníficas: su dirección conjunta como termómetro de a dónde va el mercado
 * (pesan ~30-35% del SPX). Aviso accionable para el vendedor de prima. Pensado para pollear.
 */
export async function spxMag7(now: Date = new Date()): Promise<SpxMag7Result> {
  const changes = await fetchStockChanges([...MAG7]).catch(() =>
    MAG7.map((ticker) => ({ ticker, price: null, changePct: null })),
  );
  return { breadth: mag7Breadth(changes), generatedAt: now.toISOString() };
}
