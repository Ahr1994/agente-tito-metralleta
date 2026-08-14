import { describe, it, expect } from "vitest";
import { swingFlowMap, type SwingPrint } from "./swingFlow";

const NOW = new Date("2026-08-13T16:00:00Z");
function p(over: Partial<SwingPrint> = {}): SwingPrint {
  return {
    strike: 240, type: "call", expiration: "2026-09-18", rawSide: "ABOVE_ASK",
    premium: 5_900_000, size: 3750, oi: 1018, delta: 0.49, spot: 234, price: 15.7, ...over,
  };
}

describe("swingFlowMap — divergencia HON (compra Sept / venta Oct = techo)", () => {
  const prints: SwingPrint[] = [
    // 240C Sept 18 COMPRADO (alcista corto plazo)
    p({ strike: 240, expiration: "2026-09-18", rawSide: "ABOVE_ASK", premium: 5_900_000, size: 3750 }),
    // 240C Oct 16 VENDIDO (techo)
    p({ strike: 240, expiration: "2026-10-16", rawSide: "AT_BID", premium: 4_700_000, size: 5000, price: 9.4 }),
  ];
  const r = swingFlowMap(prints, NOW);

  it("detecta la divergencia de techo con timing", () => {
    expect(r.divergences).toHaveLength(1);
    expect(r.divergences[0]).toMatchObject({ strike: 240, accExp: "2026-09-18", writeExp: "2026-10-16" });
    expect(r.divergences[0].note).toContain("TECHO");
  });
  it("el veredicto marca 'capped' (upside limitado)", () => {
    expect(r.bias).toBe("capped");
    expect(r.verdict).toContain("TECHO");
    expect(r.verdict).toContain("240");
  });
  it("clasifica bien: 240 Sept = accumulate, 240 Oct = write", () => {
    expect(r.callAccum.find((f) => f.expiration === "2026-09-18")).toBeTruthy();
    expect(r.callCeilings.find((f) => f.expiration === "2026-10-16")).toBeTruthy();
  });
});

describe("swingFlowMap — round-trip SHOP (compró y vendió el mismo strike = estructural)", () => {
  const prints: SwingPrint[] = [
    p({ strike: 160, expiration: "2026-09-18", rawSide: "AT_ASK", premium: 31_700_000, size: 92000, price: 3.45, spot: 155, delta: 0.19 }),
    p({ strike: 160, expiration: "2026-09-18", rawSide: "AT_BID", premium: 13_160_000, size: 91998, price: 1.43, spot: 155, delta: 0.10 }),
  ];
  const r = swingFlowMap(prints, NOW);

  it("marca el 160C como round-trip (net size ≈ 0), NO direccional", () => {
    const f = r.strikes.find((x) => x.strike === 160);
    expect(f?.role).toBe("roundtrip");
    expect(r.bias).toBe("structural");
    expect(r.verdict).toContain("ROUND-TRIP");
  });
});

describe("swingFlowMap — casos base", () => {
  it("acumulación limpia en varias exps = bullish", () => {
    const r = swingFlowMap([
      p({ strike: 240, expiration: "2026-09-18", rawSide: "ABOVE_ASK", premium: 5_000_000, size: 3000 }),
      p({ strike: 245, expiration: "2026-11-20", rawSide: "AT_ASK", premium: 3_000_000, size: 2000, price: 12 }),
    ], NOW);
    expect(r.bias).toBe("bullish");
    expect(r.divergences).toHaveLength(0);
  });

  it("excluye deep-ITM (estructural)", () => {
    const r = swingFlowMap([
      p({ strike: 160, expiration: "2026-11-20", rawSide: "AT_ASK", premium: 2_000_000, size: 300, price: 74.5, delta: 0.95, spot: 234 }),
    ], NOW);
    expect(r.strikes).toHaveLength(0);
  });

  it("respeta el rango de DTE (ignora vencimientos fuera de min/max)", () => {
    const r = swingFlowMap([
      p({ strike: 240, expiration: "2026-08-15", rawSide: "AT_ASK", premium: 5_000_000, size: 3000 }), // 2d, < minDte
    ], NOW, { minDte: 7 });
    expect(r.strikes).toHaveLength(0);
  });
});
