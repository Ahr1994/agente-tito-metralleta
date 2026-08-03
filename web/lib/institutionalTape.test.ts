import { describe, it, expect } from "vitest";
import { institutionalTape, tapeSide, tapeCond } from "./institutionalTape";
import type { SpxFlowTrade } from "./spx";

function t(over: Partial<SpxFlowTrade> = {}): SpxFlowTrade {
  return {
    strike: 7400,
    type: "put",
    expiration: "2026-07-31",
    side: "bid",
    rawSide: "BIDSIDE",
    price: 1,
    premium: 300_000,
    size: 100,
    oi: 0,
    assetPrice: 7413,
    conditionId: 0,
    timestamp: "2026-07-31T14:00:00Z",
    gamma: null,
    delta: null,
    iv: null,
    ...over,
  };
}

describe("tapeSide / tapeCond", () => {
  it("mapea el side crudo a las etiquetas de la tape", () => {
    expect(tapeSide("ABOVE_ASK")).toBe("Aggr.Buy");
    expect(tapeSide("AT_ASK")).toBe("Buy");
    expect(tapeSide("BIDSIDE")).toBe("Sell");
    expect(tapeSide("BELOW_BID")).toBe("Aggr.Sell");
    expect(tapeSide("MIDMKT")).toBe("Mid");
  });
  it("condición 0 (no multileg) = SL", () => {
    expect(tapeCond(0)).toBe("SL");
    expect(tapeCond(null)).toBe("SL");
  });
});

describe("institutionalTape", () => {
  it("filtra a prints grandes, ordena por hora desc y etiqueta lado", () => {
    const tape = institutionalTape([
      t({ premium: 50_000, timestamp: "2026-07-31T14:05:00Z" }), // chico → fuera
      t({ premium: 888_000, timestamp: "2026-07-31T14:01:00Z" }),
      t({ premium: 4_400_000, timestamp: "2026-07-31T14:03:00Z" }),
    ]);
    expect(tape.count).toBe(2);
    expect(tape.prints[0].premium).toBe(4_400_000); // más reciente primero (14:03 > 14:01)
    expect(tape.prints[0].side).toBe("Sell");
    expect(tape.premiumTotal).toBe(5_288_000);
  });

  it("sesgo alcista: ventas de puts + compras de calls", () => {
    const tape = institutionalTape([
      t({ type: "put", rawSide: "BIDSIDE", premium: 3_000_000 }), // venta de put → alcista
      t({ type: "call", rawSide: "AT_ASK", premium: 1_000_000 }), // compra de call → alcista
      t({ type: "put", rawSide: "AT_ASK", premium: 500_000 }), // compra de put → bajista
    ]);
    expect(tape.bullishPremium).toBe(4_000_000);
    expect(tape.bearishPremium).toBe(500_000);
    expect(tape.lean).toBe("bullish");
  });

  it("marca la condición ML/SL y el spot del print", () => {
    const tape = institutionalTape([t({ conditionId: 0, assetPrice: 7413.49 })]);
    expect(tape.prints[0].cond).toBe("SL");
    expect(tape.prints[0].spot).toBe(7413.49);
  });
});
