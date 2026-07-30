import { describe, it, expect } from "vitest";
import {
  deriveSpxSpot,
  splitByDte,
  spxGex,
  parseSpxFlow,
  flowBias,
  atmIvSpx,
  spxSafeExtremes,
  type SpxQuote,
  type SpxGex,
  type SpxFlowBias,
} from "./spx";
import type { RawTrade } from "./flow";

function rt(symbol: string, side: string, premium: number, extra: Partial<RawTrade> = {}): RawTrade {
  return {
    id: 1,
    symbol,
    price: 1,
    size: 1,
    side,
    bid_price: 0,
    ask_price: 0,
    premium,
    delta: 0,
    implied_volatility: 0,
    open_interest: 0,
    volume: 0,
    score: 0,
    sentiment: "",
    timestamp: "2026-07-30T14:00:00Z",
    ...extra,
  };
}

function q(
  strike: number,
  type: "call" | "put",
  price: number,
  expiration = "2026-07-30",
): SpxQuote {
  return { strike, type, expiration, price, delta: null, gamma: null, iv: null, oi: 0 };
}

function g(strike: number, type: "call" | "put", gamma: number, oi: number): SpxQuote {
  return { strike, type, expiration: "2026-07-30", price: 1, delta: null, gamma, iv: null, oi };
}

describe("deriveSpxSpot — paridad put-call", () => {
  it("deriva spot = K + C − P y toma la mediana", () => {
    const quotes = [
      q(7300, "call", 100),
      q(7300, "put", 56), // 7300+100-56 = 7344
      q(7350, "call", 71),
      q(7350, "put", 76), // 7350+71-76 = 7345
      q(7400, "call", 45),
      q(7400, "put", 102), // 7400+45-102 = 7343
    ];
    // estimaciones [7343, 7344, 7345] → mediana 7344
    expect(deriveSpxSpot(quotes)).toBe(7344);
  });

  it("ignora strikes sin ambas patas o sin precio", () => {
    expect(deriveSpxSpot([q(7000, "call", 300)])).toBeNull(); // sin put
    expect(deriveSpxSpot([q(7000, "call", 0), q(7000, "put", 5)])).toBeNull(); // call sin precio
  });
});

describe("spxGex — muros de gamma real", () => {
  it("callWall sobre el spot, putWall bajo el spot, imán en el mayor |netGex|", () => {
    const spot = 7350;
    const quotes = [
      // muro de puts bajo el spot (soporte): mucha gamma×OI de puts en 7300
      g(7300, "put", 0.002, 30000),
      g(7300, "call", 0.001, 2000),
      // strike cerca del spot con calls dominando (imán): net positivo grande
      g(7350, "call", 0.003, 25000),
      g(7350, "put", 0.001, 3000),
      // muro de calls sobre el spot (resistencia): mucha gamma×OI de calls en 7400
      g(7400, "call", 0.002, 28000),
      g(7400, "put", 0.0005, 1000),
    ];
    const r = spxGex(quotes, spot);
    expect(r.putWall).toBe(7300); // mayor GEX de puts bajo el spot
    expect(r.callWall).toBe(7400); // mayor GEX de calls sobre el spot
    expect(r.magnet).toBe(7350); // mayor |netGex|
    expect(r.totalNetGex).toBeGreaterThan(0);
    expect(r.regime).toBe("positive"); // calls dominan → gamma neta +, pinnea
  });

  it("régimen negativo cuando los puts dominan la gamma neta", () => {
    const spot = 7350;
    const quotes = [
      g(7300, "put", 0.004, 40000),
      g(7400, "call", 0.001, 5000),
    ];
    const r = spxGex(quotes, spot);
    expect(r.totalNetGex).toBeLessThan(0);
    expect(r.regime).toBe("negative"); // puts dominan → amplifica
  });

  it("ignora contratos sin gamma/OI y devuelve vacío sin datos válidos", () => {
    expect(spxGex([g(7300, "call", 0, 100), q(7300, "put", 5)], 7350).nodes).toHaveLength(0);
    expect(spxGex([], 7350).callWall).toBeNull();
    expect(spxGex([g(7300, "call", 0.001, 100)], 0).magnet).toBeNull(); // spot inválido
  });
});

describe("parseSpxFlow + flowBias", () => {
  it("parsea SPXW OCC, filtra a SPX y clasifica agresividad", () => {
    const raw = [
      rt("SPXW260730C07400000", "ASKSIDE", 500_000, { gamma: 0.001, delta: 0.1 }),
      rt("SPXW260730P07300000", "BIDSIDE", 200_000),
      rt("AAPL260730C00200000", "ASKSIDE", 999_999), // otro subyacente → se ignora
      rt("basura", "ASKSIDE", 1),
    ];
    const parsed = parseSpxFlow(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ strike: 7400, type: "call", side: "ask" });
    expect(parsed[1]).toMatchObject({ strike: 7300, type: "put", side: "bid" });
  });

  it("flowBias alcista (compras de calls al ask) → vender put spread", () => {
    const trades = parseSpxFlow([
      rt("SPXW260730C07400000", "ASKSIDE", 800_000), // call comprada → alcista
      rt("SPXW260730P07300000", "BIDSIDE", 300_000), // put vendida → alcista
      rt("SPXW260730P07200000", "ASKSIDE", 100_000), // put comprada → bajista
    ]);
    const b = flowBias(trades);
    expect(b.bullishPremium).toBe(1_100_000);
    expect(b.bearishPremium).toBe(100_000);
    expect(b.lean).toBe("bullish");
    expect(b.sellSide).toBe("put");
  });

  it("flowBias bajista (compras de puts al ask) → vender call spread", () => {
    const trades = parseSpxFlow([
      rt("SPXW260730P07300000", "ASKSIDE", 900_000), // put comprada → bajista
      rt("SPXW260730C07400000", "BIDSIDE", 200_000), // call vendida → bajista
    ]);
    const b = flowBias(trades);
    expect(b.lean).toBe("bearish");
    expect(b.sellSide).toBe("call");
  });

  it("flowBias neutral cuando está equilibrado", () => {
    const trades = parseSpxFlow([
      rt("SPXW260730C07400000", "ASKSIDE", 500_000),
      rt("SPXW260730P07300000", "ASKSIDE", 500_000),
    ]);
    expect(flowBias(trades).lean).toBe("neutral");
    expect(flowBias([]).sellSide).toBe("either");
  });
});

describe("atmIvSpx", () => {
  it("toma el mínimo call/put del strike más cercano al spot", () => {
    const quotes: SpxQuote[] = [
      { strike: 7350, type: "call", expiration: "2026-07-30", price: 40, delta: 0.5, gamma: 0.001, iv: 0.12, oi: 100 },
      { strike: 7350, type: "put", expiration: "2026-07-30", price: 40, delta: -0.5, gamma: 0.001, iv: 0.9, oi: 100 }, // iv basura
      { strike: 7500, type: "call", expiration: "2026-07-30", price: 2, delta: 0.05, gamma: 0.0005, iv: 0.2, oi: 100 },
    ];
    expect(atmIvSpx(quotes, 7352)).toBeCloseTo(0.12); // min(0.12, 0.9) del strike 7350
    expect(atmIvSpx([], 7350)).toBeNull();
  });
});

describe("spxSafeExtremes — Fase 3", () => {
  // Cadena sintética alrededor del spot 7350, delta y precio decrecientes hacia OTM.
  function chain(): SpxQuote[] {
    const q: SpxQuote[] = [];
    // puts: strike < spot, |delta| baja al alejarse
    const puts: [number, number, number][] = [
      [7350, 0.5, 40], [7340, 0.4, 32], [7330, 0.3, 24], [7320, 0.2, 16],
      [7310, 0.1, 9], [7305, 0.07, 6], [7300, 0.05, 4], [7295, 0.03, 2.5], [7290, 0.02, 1.5],
    ];
    for (const [k, d, p] of puts)
      q.push({ strike: k, type: "put", expiration: "2026-07-30", price: p, delta: -d, gamma: 0.001, iv: 0.12, oi: 5000 });
    const calls: [number, number, number][] = [
      [7350, 0.5, 40], [7360, 0.4, 32], [7370, 0.3, 24], [7380, 0.2, 16],
      [7390, 0.1, 9], [7395, 0.07, 6], [7400, 0.05, 4], [7405, 0.03, 2.5], [7410, 0.02, 1.5],
    ];
    for (const [k, d, p] of calls)
      q.push({ strike: k, type: "call", expiration: "2026-07-30", price: p, delta: d, gamma: 0.001, iv: 0.12, oi: 5000 });
    return q;
  }
  const gex: SpxGex = {
    nodes: [], callWall: 7385, putWall: 7320, magnet: 7350, flip: 7345,
    regime: "positive", totalNetGex: 1,
  };

  it("da un extremo por lado, short OTM, credit>0, con EV evaluado", () => {
    const bias: SpxFlowBias = { bullishPremium: 3, bearishPremium: 1, netPct: 50, lean: "bullish", sellSide: "put" };
    const s = spxSafeExtremes(chain(), 7350, gex, bias, {});
    const put = s.extremes.find((e) => e.side === "put");
    const call = s.extremes.find((e) => e.side === "call");
    expect(put).toBeTruthy();
    expect(call).toBeTruthy();
    expect(put!.spread.kind).toBe("bull_put");
    expect(put!.spread.shortStrike).toBeLessThan(7350);
    expect(put!.spread.credit).toBeGreaterThan(0);
    expect(put!.spread.probOTM).toBeGreaterThan(50);
    expect(["wall", "sigma", "delta"]).toContain(put!.anchor);
    expect(put!.breakevenWinPct).toBeGreaterThanOrEqual(0);
    expect(typeof put!.evOk).toBe("boolean");
  });

  it("modo prima: elige el spread por banda de crédito y reporta el delta del short", () => {
    const bias: SpxFlowBias = { bullishPremium: 1, bearishPremium: 1, netPct: 0, lean: "neutral", sellSide: "either" };
    // puts width-5 disponibles: 7300/7295 = 4−2.5 = $150 ; 7295/7290 = 2.5−1.5 = $100
    const s = spxSafeExtremes(chain(), 7350, gex, bias, { width: 5, credit: { min: 0.9, max: 1.6 } });
    const put = s.extremes.find((e) => e.side === "put");
    expect(put).toBeTruthy();
    const creditDollars = put!.spread.credit * 100;
    expect(creditDollars).toBeGreaterThanOrEqual(90);
    expect(creditDollars).toBeLessThanOrEqual(160);
    expect(put!.shortDelta).not.toBeNull();
    expect(["wall", "credit"]).toContain(put!.anchor);
  });

  it("marca recommended según el lado que sugiere el flujo", () => {
    const bullish: SpxFlowBias = { bullishPremium: 3, bearishPremium: 1, netPct: 50, lean: "bullish", sellSide: "put" };
    const s = spxSafeExtremes(chain(), 7350, gex, bullish, {});
    expect(s.extremes.find((e) => e.side === "put")!.recommended).toBe(true);
    expect(s.extremes.find((e) => e.side === "call")!.recommended).toBe(false);
    expect(s.atmIv).toBeCloseTo(0.12);
    expect(s.sigma1Pct).toBeGreaterThan(0);
  });
});

describe("splitByDte", () => {
  const now = new Date("2026-07-30T15:00:00Z"); // 11am ET → día de mercado 2026-07-30
  it("separa 0DTE (hoy) y 1DTE (próximo vencimiento)", () => {
    const quotes = [
      q(7300, "call", 10, "2026-07-30"), // 0DTE
      q(7300, "put", 10, "2026-07-30"),
      q(7300, "call", 20, "2026-07-31"), // 1DTE
      q(7300, "call", 30, "2026-08-03"), // 2DTE+
    ];
    const r = splitByDte(quotes, now);
    expect(r.zeroExp).toBe("2026-07-30");
    expect(r.oneExp).toBe("2026-07-31");
    expect(r.zeroDte).toHaveLength(2);
    expect(r.oneDte).toHaveLength(1);
  });

  it("1DTE es el siguiente vencimiento disponible (robusto a huecos/fin de semana)", () => {
    const quotes = [
      q(7300, "call", 10, "2026-07-30"), // 0DTE
      q(7300, "call", 20, "2026-08-03"), // no hay 07-31: el siguiente es 08-03
    ];
    const r = splitByDte(quotes, now);
    expect(r.zeroExp).toBe("2026-07-30");
    expect(r.oneExp).toBe("2026-08-03");
  });

  it("sin 0DTE si no hay vencimiento hoy", () => {
    const quotes = [q(7300, "call", 20, "2026-07-31")];
    const r = splitByDte(quotes, now);
    expect(r.zeroExp).toBeNull();
    expect(r.oneExp).toBe("2026-07-31");
  });
});
