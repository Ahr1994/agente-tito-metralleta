import { describe, it, expect } from "vitest";
import { inClosingWindow, detectClosingSells, reviewClosingSells, contractKey } from "./closingFlow";
import type { SpxFlowTrade } from "./spx";

// 2026-07-30 es jueves. 19:45 UTC = 15:45 ET (dentro del power hour); 17:00 UTC = 13:00 ET (no).
const IN_WINDOW = Date.parse("2026-07-30T19:45:00Z");
const OUT_WINDOW = Date.parse("2026-07-30T17:00:00Z");

function ft(over: Partial<SpxFlowTrade> = {}): SpxFlowTrade {
  return {
    strike: 7300,
    type: "put",
    expiration: "2026-07-31", // 1DTE
    side: "bid", // venta
    rawSide: "BIDSIDE",
    price: 1,
    premium: 300_000,
    size: 500,
    oi: 1000,
    assetPrice: null,
    conditionId: null,
    timestamp: "2026-07-30T19:45:00Z",
    gamma: null,
    delta: null,
    iv: null,
    ...over,
  };
}

describe("inClosingWindow", () => {
  it("15:45 ET dentro; 13:00 ET fuera", () => {
    expect(inClosingWindow(IN_WINDOW)).toBe(true);
    expect(inClosingWindow(OUT_WINDOW)).toBe(false);
  });
  it("timestamp inválido → false", () => {
    expect(inClosingWindow(NaN)).toBe(false);
  });
});

describe("detectClosingSells", () => {
  const now = new Date("2026-07-30T19:50:00Z");

  it("agrupa ventas grandes del power hour por contrato, ignora compras y fuera de ventana", () => {
    const trades = [
      ft({ premium: 300_000, size: 500 }),
      ft({ premium: 200_000, size: 300 }), // mismo contrato → suma $500k / 800
      ft({ side: "ask", premium: 900_000 }), // compra → se ignora
      ft({ timestamp: "2026-07-30T17:00:00Z", premium: 900_000 }), // fuera de ventana → se ignora
      ft({ strike: 7500, type: "call", premium: 100_000 }), // muy chico (<250k) → se filtra
    ];
    const sells = detectClosingSells(trades, now);
    expect(sells).toHaveLength(1);
    expect(sells[0]).toMatchObject({ strike: 7300, type: "put", totalPremium: 500_000, totalSize: 800, tradeCount: 2 });
    expect(sells[0].dte).toBe(1);
  });

  it("descarta vencimientos lejanos (> maxDte)", () => {
    const trades = [ft({ expiration: "2026-08-20", premium: 1_000_000 })];
    expect(detectClosingSells(trades, now)).toHaveLength(0);
  });
});

describe("reviewClosingSells", () => {
  it("confirma cuando el OI del día siguiente subió ≈ lo vendido", () => {
    const stored = detectClosingSells([ft({ premium: 300_000, size: 500, oi: 1000 })], new Date("2026-07-30T19:50:00Z"));
    const oiMap = new Map([[contractKey(stored[0]), 1400]]); // subió 400 (≥ 250 = 500×0.5)
    const [r] = reviewClosingSells(stored, oiMap);
    expect(r.currentOi).toBe(1400);
    expect(r.oiChange).toBe(400);
    expect(r.confirmed).toBe(true);
  });

  it("no confirma si el OI casi no cambió", () => {
    const stored = detectClosingSells([ft({ premium: 300_000, size: 500, oi: 1000 })], new Date("2026-07-30T19:50:00Z"));
    const [r] = reviewClosingSells(stored, new Map([[contractKey(stored[0]), 1050]]));
    expect(r.confirmed).toBe(false);
    expect(r.oiChange).toBe(50);
  });

  it("OI desconocido → sin confirmar", () => {
    const stored = detectClosingSells([ft()], new Date("2026-07-30T19:50:00Z"));
    const [r] = reviewClosingSells(stored, new Map());
    expect(r.currentOi).toBeNull();
    expect(r.confirmed).toBe(false);
  });
});
