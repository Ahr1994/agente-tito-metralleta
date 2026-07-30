import { describe, it, expect } from "vitest";
import { monitorPosition, type MonitorPosition, type PositionMarket } from "./positionMonitor";

// Bull put típico: vendió 7400 / compró 7395, crédito $0.90. Riesgo = que el precio BAJE.
const bullPut: MonitorPosition = {
  kind: "bull_put",
  shortStrike: 7400,
  longStrike: 7395,
  credit: 0.9,
  expiration: "2026-07-31",
};

function market(over: Partial<PositionMarket> = {}): PositionMarket {
  return {
    spot: 7450,
    shortDelta: 0.15,
    shortMark: 0.8,
    longMark: 0.5,
    adversePremium: 0,
    favorablePremium: 1_000_000,
    flowLean: "bullish",
    regime: "positive",
    defendingWall: 7420,
    sigma1Pct: 0.7,
    ...over,
  };
}

describe("monitorPosition — bull put", () => {
  it("AGUANTA cuando el spot está lejos, defendido y sin flujo en contra", () => {
    const s = monitorPosition(bullPut, market());
    expect(s.action).toBe("hold");
    expect(s.wallDefends).toBe(true);
    expect(s.breachedShort).toBe(false);
  });

  it("VIGILA cuando entra flujo agresivo en contra (compras de puts) dentro de 1σ", () => {
    const s = monitorPosition(
      bullPut,
      market({
        spot: 7415, // a 15 pts del short, dentro de 1σ (σ≈52)
        flowLean: "bearish",
        adversePremium: 3_000_000,
        favorablePremium: 500_000,
        shortDelta: 0.3,
      }),
    );
    expect(s.adverse).toBe(true);
    expect(s.action).toBe("watch");
    expect(s.reasons.join(" ")).toMatch(/EN CONTRA/);
  });

  it("SALIR cuando el precio rompe el short Y hay flujo en contra", () => {
    const s = monitorPosition(
      bullPut,
      market({ spot: 7398, flowLean: "bearish", adversePremium: 4_000_000, favorablePremium: 200_000, shortDelta: 0.55 }),
    );
    expect(s.breachedShort).toBe(true);
    expect(s.action).toBe("exit");
  });

  it("SALIR cuando se rompe el breakeven", () => {
    const s = monitorPosition(bullPut, market({ spot: 7399 })); // breakeven = 7400−0.90 = 7399.1
    expect(s.breachedBreakeven).toBe(true);
    expect(s.action).toBe("exit");
  });

  it("VIGILA (no salir) si el precio se acercó al strike pero sin flujo en contra", () => {
    const s = monitorPosition(bullPut, market({ spot: 7405, shortDelta: 0.5, flowLean: "neutral", adversePremium: 0 }));
    expect(s.action).toBe("watch");
  });

  it("VIGILA cuando está pegado al short y en pérdida, aunque no haya flujo en contra", () => {
    // spot 7405 a 5 pts del short (0.1σ), delta 0.43 (<0.45), spread encarecido → en contra
    const s = monitorPosition(
      bullPut,
      market({ spot: 7405, shortDelta: 0.43, shortMark: 1.7, longMark: 0.5, flowLean: "neutral", adversePremium: 0 }),
    );
    expect(s.action).toBe("watch");
    expect(s.profitCapturedPct).toBeLessThan(0); // el spread vale más de lo cobrado
  });

  it("CERRAR (take-profit) cuando el spread ya casi no vale", () => {
    const s = monitorPosition(bullPut, market({ shortMark: 0.15, longMark: 0.05 })); // valor $10 vs crédito $90 → 89%
    expect(s.profitCapturedPct).toBeGreaterThanOrEqual(75);
    expect(s.action).toBe("take_profit");
  });
});

describe("monitorPosition — bear call (dirección opuesta)", () => {
  const bearCall: MonitorPosition = {
    kind: "bear_call",
    shortStrike: 7500,
    longStrike: 7505,
    credit: 0.9,
    expiration: "2026-07-31",
  };
  it("el flujo en contra es la compra de CALLS (alcista)", () => {
    const s = monitorPosition(
      bearCall,
      market({
        spot: 7485,
        flowLean: "bullish",
        adversePremium: 3_000_000,
        favorablePremium: 400_000,
        defendingWall: 7480,
        shortDelta: 0.3,
      }),
    );
    expect(s.adverse).toBe(true);
    expect(s.action).toBe("watch");
    expect(s.reasons.join(" ")).toMatch(/comprando calls/);
  });
});
