import { describe, it, expect } from "vitest";
import { mag7Breadth, MAG7 } from "./mag7";

function all(pct: number) {
  return MAG7.map((ticker) => ({ ticker, changePct: pct, price: 100 }));
}

describe("mag7Breadth", () => {
  it("las 7 arriba juntas → strong_bullish + aviso de bear call", () => {
    const b = mag7Breadth(all(1.2));
    expect(b.upCount).toBe(7);
    expect(b.unanimous).toBe(true);
    expect(b.lean).toBe("strong_bullish");
    expect(b.warning).toMatch(/bear call/i);
  });

  it("las 7 abajo juntas → strong_bearish + aviso de bull put", () => {
    const b = mag7Breadth(all(-0.9));
    expect(b.lean).toBe("strong_bearish");
    expect(b.unanimous).toBe(true);
    expect(b.warning).toMatch(/bull put/i);
  });

  it("mixtas → neutral, sin aviso", () => {
    const mixed = MAG7.map((ticker, i) => ({ ticker, changePct: i % 2 === 0 ? 0.5 : -0.5, price: 100 }));
    const b = mag7Breadth(mixed);
    expect(b.lean).toBe("neutral");
    expect(b.unanimous).toBe(false);
    expect(b.warning).toBeNull();
  });

  it("6 de 7 arriba → bullish con aviso", () => {
    const s = MAG7.map((ticker, i) => ({ ticker, changePct: i === 0 ? -0.2 : 0.6, price: 100 }));
    const b = mag7Breadth(s);
    expect(b.upCount).toBe(6);
    expect(b.lean).toBe("bullish");
    expect(b.warning).toMatch(/bear call/i);
  });

  it("ignora tickers sin dato", () => {
    const s = MAG7.map((ticker, i) => ({ ticker, changePct: i < 2 ? null : 0.8, price: 100 }));
    const b = mag7Breadth(s);
    expect(b.upCount).toBe(5); // 5 con dato, todas arriba
    expect(b.unanimous).toBe(true);
  });

  it("promedio de cambio", () => {
    const b = mag7Breadth(all(1.0));
    expect(b.avgChangePct).toBe(1.0);
  });
});
