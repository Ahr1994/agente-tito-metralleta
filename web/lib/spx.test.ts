import { describe, it, expect } from "vitest";
import { deriveSpxSpot, splitByDte, type SpxQuote } from "./spx";

function q(
  strike: number,
  type: "call" | "put",
  price: number,
  expiration = "2026-07-30",
): SpxQuote {
  return { strike, type, expiration, price, delta: null, gamma: null, iv: null, oi: 0 };
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
