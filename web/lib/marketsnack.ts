// Cliente del API interno de MarketSnack (app.marketsnack.com). Solo servidor.
// Auth por cookie de sesión (MARKETSNACK_COOKIE en .env.local). Ver SCOREDCARD/Scoredcard.md.

import type { RawTrade } from "./flow";
import { parseSpxFlow, spxDaySentiment, type SpxFlowTrade, type SpxDaySentiment } from "./spx";

const BASE_URL = "https://app.marketsnack.com";

export class MarketSnackError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MarketSnackError";
    this.status = status;
  }
}

function cookie(): string {
  const c = process.env.MARKETSNACK_COOKIE;
  if (!c || !c.trim()) {
    throw new MarketSnackError(
      "Falta MARKETSNACK_COOKIE en .env.local. Copia tu cookie de sesión de app.marketsnack.com.",
    );
  }
  return c.trim();
}

export interface FetchFlowOptions {
  period?: string; // "1d" | "5d" | "1m"
  maxPages?: number;
  minPremium?: number; // filtro server-side: solo trades con premium ≥ este valor ($)
  targetDays?: number; // detener la paginación al cubrir N días hacia atrás
  timeoutMs?: number; // timeout por request; si MarketSnack anda lento, falla rápido (default 8s)
  onPage?: (page: number, accumulated: number) => void | Promise<void>;
}

export interface FlowResult {
  trades: RawTrade[];
  pages: number;
  truncated: boolean;
}

/**
 * Descarga el flujo (Time & Sales) de un ticker desde MarketSnack, paginando por
 * `next_page_token`. Endpoint: /api/flow_feed?filter[scope]=all&filter[symbol][]=TICKER&period=…
 */
export async function fetchFlow(
  ticker: string,
  opts: FetchFlowOptions = {},
): Promise<FlowResult> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) throw new MarketSnackError("Ticker vacío.");
  return paginate(clean, opts);
}

/**
 * Igual que `fetchFlow` pero SIN filtro de símbolo: devuelve el flujo de todo el
 * mercado. Es lo que alimenta el screener de /ideas — el piso de premium
 * (`minPremium`) filtra server-side, así que el payload se mantiene chico.
 */
export async function fetchMarketFlow(opts: FetchFlowOptions = {}): Promise<FlowResult> {
  return paginate(null, opts);
}

/**
 * Flujo SPX del día ya parseado (strike/tipo/vto por OCC + agresividad bid/ask). Reusa
 * `fetchFlow("SPX")` — MarketSnack devuelve los SPXW del 0DTE/1DTE con side y gamma, que es
 * lo que alimenta el sesgo de flujo y ancla el GEX. Ver lib/spx.ts.
 */
export async function fetchSpxFlow(
  opts: FetchFlowOptions = {},
): Promise<{ trades: SpxFlowTrade[]; pages: number; truncated: boolean }> {
  const { trades, pages, truncated } = await fetchFlow("SPX", { period: "1d", ...opts });
  return { trades: parseSpxFlow(trades), pages, truncated };
}

/** Cuerpo de paginación compartido. `symbol === null` → escaneo de todo el mercado. */
async function paginate(
  symbol: string | null,
  opts: FetchFlowOptions = {},
): Promise<FlowResult> {
  const clean = symbol;
  const period = opts.period ?? "5d";
  const maxPages = opts.maxPages ?? 10;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const cookieHeader = cookie();

  const trades: RawTrade[] = [];
  let token: string | null = null;
  let page = 0;
  let truncated = false;
  // La paginación del feed camina hacia atrás en el tiempo; con targetDays paramos
  // al cubrir la ventana pedida.
  const cutoffMs = opts.targetDays ? Date.now() - opts.targetDays * 86_400_000 : null;

  do {
    page += 1;
    const params = new URLSearchParams();
    params.set("filter[scope]", "all");
    if (clean) params.append("filter[symbol][]", clean);
    params.set("period", period);
    if (opts.minPremium && opts.minPremium > 0) {
      params.set("filter[premium][gte]", String(Math.floor(opts.minPremium)));
    }
    if (token) params.set("next_page_token", token);
    const url = `${BASE_URL}/api/flow_feed?${params.toString()}`;

    // Timeout por request: si MarketSnack anda lento/degradado, abortamos y el llamador cae
    // a flujo neutral (el GEX se calcula igual desde Massive). Ver docs del módulo SPX.
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", Cookie: cookieHeader },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new MarketSnackError(
          `MarketSnack no respondió en ${timeoutMs / 1000}s (servidor lento). Se sigue sin flujo.`,
        );
      }
      throw new MarketSnackError(
        `No se pudo conectar con MarketSnack: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Sesión inválida/expirada → MarketSnack redirige a /login o responde 401.
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new MarketSnackError(
        "Sesión de MarketSnack inválida o expirada. Actualiza MARKETSNACK_COOKIE en .env.local.",
        res.status,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MarketSnackError(
        `MarketSnack respondió ${res.status}. ${body.slice(0, 200)}`.trim(),
        res.status,
      );
    }

    const json: { list?: RawTrade[]; meta?: { next_page_token?: string } } =
      await res.json();
    const list = json.list ?? [];
    trades.push(...list);
    await opts.onPage?.(page, trades.length);

    token = json.meta?.next_page_token ?? null;
    if (list.length === 0) break;
    if (cutoffMs != null) {
      const oldest = list[list.length - 1]?.timestamp;
      if (oldest && Date.parse(oldest) < cutoffMs) break; // ventana cubierta
    }
    if (page >= maxPages) {
      truncated = Boolean(token);
      break;
    }
  } while (token);

  return { trades, pages: page, truncated };
}

/** GET autenticado al API de MarketSnack (base /api). Reusa la cookie de sesión. */
async function msGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    headers: { Accept: "application/json", Cookie: cookie() },
    cache: "no-store",
    redirect: "manual",
  });
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new MarketSnackError(
      "Sesión de MarketSnack inválida o expirada. Actualiza MARKETSNACK_COOKIE en .env.local.",
      res.status,
    );
  }
  if (!res.ok) throw new MarketSnackError(`MarketSnack respondió ${res.status}.`, res.status);
  return (await res.json()) as T;
}

export interface SpxIndexQuote {
  price: number; // valor del índice en tiempo real (plan Indices)
  delayed: boolean;
  changePct: number | null;
  prevClose: number | null;
}

/**
 * Precio del índice SPX en TIEMPO REAL desde MarketSnack (plan GEX & Indices). Resuelve el
 * problema del spot retrasado — antes se derivaba por paridad porque Massive da 403 en el índice.
 */
export async function fetchSpxIndex(symbol = "SPX"): Promise<SpxIndexQuote | null> {
  try {
    const d = await msGet<{
      latest_price?: number;
      regular_price?: number;
      delayed_price?: boolean;
      prev_close_price?: number;
      regular_price_change?: { percentage?: number };
    }>(`/assets/${encodeURIComponent(symbol)}`);
    const price = d.latest_price ?? d.regular_price;
    if (price == null || !(price > 0)) return null;
    return {
      price,
      delayed: Boolean(d.delayed_price),
      changePct: d.regular_price_change?.percentage ?? null,
      prevClose: d.prev_close_price ?? null,
    };
  } catch {
    return null;
  }
}

export interface MsGexSnapshot {
  netGex: number | null;
  callWall: number | null;
  putWall: number | null;
  magnet: number | null;
  maxPain: number | null;
  gammaFlip: number | null;
  assetPrice: number | null;
  at: string | null;
}

/**
 * GEX oficial de MarketSnack (muros de call/put, imán, max pain, flip, net GEX) — su propio
 * cálculo, más autoritativo que el que el agente estima. Toma la foto más reciente de la serie.
 */
export async function fetchSpxMsGex(symbol = "SPX"): Promise<MsGexSnapshot | null> {
  try {
    const d = await msGet<{
      data?: {
        net_gex?: number;
        call_wall?: number;
        put_wall?: number;
        magnet?: number;
        max_pain?: number;
        gamma_flip?: number;
        asset_price?: number;
        t?: string;
      }[];
    }>(`/assets/${encodeURIComponent(symbol)}/gex_stats_chart`);
    const last = d.data?.[d.data.length - 1];
    if (!last) return null;
    return {
      netGex: last.net_gex ?? null,
      callWall: last.call_wall ?? null,
      putWall: last.put_wall ?? null,
      magnet: last.magnet ?? null,
      maxPain: last.max_pain ?? null,
      gammaFlip: last.gamma_flip ?? null,
      assetPrice: last.asset_price ?? null,
      at: last.t ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Sentiment del día completo de SPX (desglose de premium calls/puts comprados/vendidos). Más
 * autoritativo que la tape reciente porque MarketSnack lo agrega sobre toda la sesión.
 */
export async function fetchSpxSentiment(symbol = "SPX"): Promise<SpxDaySentiment | null> {
  try {
    const d = await msGet<{
      sentiment_breakdown?: {
        calls_bought?: { premium?: number };
        calls_sold?: { premium?: number };
        puts_bought?: { premium?: number };
        puts_sold?: { premium?: number };
      };
    }>(`/assets/${encodeURIComponent(symbol)}/sentiment`);
    const sb = d.sentiment_breakdown;
    if (!sb) return null;
    return spxDaySentiment({
      callsBought: sb.calls_bought?.premium ?? 0,
      callsSold: sb.calls_sold?.premium ?? 0,
      putsBought: sb.puts_bought?.premium ?? 0,
      putsSold: sb.puts_sold?.premium ?? 0,
    });
  } catch {
    return null;
  }
}
