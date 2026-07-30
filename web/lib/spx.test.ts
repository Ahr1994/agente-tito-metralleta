import { describe, it, expect } from "vitest";
import {
  deriveSpxSpot,
  splitByDte,
  spxGex,
  parseSpxFlow,
  flowBias,
  type SpxQuote,
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
