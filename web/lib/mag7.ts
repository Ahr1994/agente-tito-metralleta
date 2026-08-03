// Monitor de las 7 Magníficas: pesan ~30-35% del S&P 500, así que su dirección conjunta es
// un termómetro de hacia dónde empuja el mercado (y el SPX). Cuando las 7 suben juntas, es
// compra amplia → veneno para un bear call; las 7 bajando → veneno para un bull put. PURO.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

export const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] as const;

export interface Mag7Stock {
  ticker: string;
  changePct: number | null;
  price: number | null;
  up: boolean | null; // null si no hay dato
}

export type Mag7Lean = "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";

export interface Mag7Breadth {
  stocks: Mag7Stock[];
  upCount: number;
  downCount: number;
  avgChangePct: number; // promedio simple del % de cambio
  lean: Mag7Lean;
  unanimous: boolean; // TODAS con dato van en la misma dirección
  headline: string;
  warning: string | null; // aviso accionable para el vendedor de prima
}

/**
 * Resume la dirección conjunta de las 7. La UNANIMIDAD es la señal fuerte (todas verdes/rojas);
 * si no, se mide por cuántas suben y el promedio de cambio.
 */
export function mag7Breadth(input: { ticker: string; changePct: number | null; price: number | null }[]): Mag7Breadth {
  const stocks: Mag7Stock[] = input.map((s) => ({
    ticker: s.ticker,
    changePct: s.changePct,
    price: s.price,
    up: s.changePct == null ? null : s.changePct > 0,
  }));
  const withData = stocks.filter((s) => s.up != null);
  const upCount = withData.filter((s) => s.up).length;
  const downCount = withData.filter((s) => !s.up).length;
  const avgChangePct =
    withData.length > 0
      ? Math.round((withData.reduce((a, s) => a + (s.changePct as number), 0) / withData.length) * 100) / 100
      : 0;

  const n = withData.length;
  const unanimous = n > 0 && (upCount === n || downCount === n);

  let lean: Mag7Lean;
  if (n === 0) lean = "neutral";
  else if (upCount === n && avgChangePct >= 0.4) lean = "strong_bullish";
  else if (upCount >= Math.ceil(n * 0.7)) lean = "bullish";
  else if (downCount === n && avgChangePct <= -0.4) lean = "strong_bearish";
  else if (downCount >= Math.ceil(n * 0.7)) lean = "bearish";
  else lean = "neutral";

  const HEAD: Record<Mag7Lean, string> = {
    strong_bullish: "🟢🟢 Las 7 suben JUNTAS — empuje alcista fuerte",
    bullish: "🟢 Mag 7 mayormente arriba — sesgo alcista",
    neutral: "⚪ Mag 7 mixtas — sin dirección clara",
    bearish: "🔴 Mag 7 mayormente abajo — sesgo bajista",
    strong_bearish: "🔴🔴 Las 7 bajan JUNTAS — empuje bajista fuerte",
  };

  let warning: string | null = null;
  if (lean === "strong_bullish" || (lean === "bullish" && upCount >= 6))
    warning = "Riesgo ALCISTA: las Mag 7 empujan el mercado arriba → cuidado vendiendo el tope (bear call).";
  else if (lean === "strong_bearish" || (lean === "bearish" && downCount >= 6))
    warning = "Riesgo BAJISTA: las Mag 7 empujan el mercado abajo → cuidado vendiendo el piso (bull put).";

  return {
    stocks,
    upCount,
    downCount,
    avgChangePct,
    lean,
    unanimous,
    headline: HEAD[lean],
    warning,
  };
}
