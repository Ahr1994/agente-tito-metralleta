import { describe, it, expect } from "vitest";
import {
  suggestCreditSpreads,
  suggestSpreadsAtSigma,
  suggestHedge,
  type OptionQuote,
} from "./premiumSell";

describe("suggestSpreadsAtSigma — venta en extremos (±Nσ)", () => {
  const q: OptionQuote[] = [
    { strike: 80, type: "put", price: 0.5, delta: -0.05, oi: 10 },
    { strike: 75, type: "put", price: 0.3, delta: -0.03, oi: 10 },
    { strike: 90, type: "put", price: 1.2, delta: -0.15, oi: 10 },
    { strike: 120, type: "call", price: 0.5, delta: 0.05, oi: 10 },
    { strike: 125, type: "call", price: 0.3, delta: 0.03, oi: 10 },
  ];
  it("pone el short en ±2σ", () => {
    // 1σ = 10% de 100 = 10 → 2σ = 20 → put target 80, call target 120
    const r = suggestSpreadsAtSigma(q, 100, { supports: [], resistances: [] }, 10, {
      sigmaMult: 2,
      width: 5,
    });
    expect(r.putSpread?.shortStrike).toBe(80);
    expect(r.putSpread?.longStrike).toBe(75);
    expect(r.putSpread?.credit).toBeCloseTo(0.2, 5);
    expect(r.callSpread?.shortStrike).toBe(120);
    expect(r.callSpread?.longStrike).toBe(125);
  });
});

// Cadena sintética alrededor de spot 100, con deltas y precios controlados.
const quotes: OptionQuote[] = [
  // puts (OTM hacia abajo)
  { strike: 90, type: "put", price: 2.0, delta: -0.25, oi: 100 }, // |Δ| > 0.20 → excluido
  { strike: 85, type: "put", price: 1.2, delta: -0.15, oi: 100 }, // candidato short
  { strike: 80, type: "put", price: 0.7, delta: -0.1, oi: 100 }, // ala
  { strike: 75, type: "put", price: 0.4, delta: -0.06, oi: 100 },
  // calls (OTM hacia arriba)
  { strike: 110, type: "call", price: 2.0, delta: 0.25, oi: 100 }, // excluido por delta
  { strike: 115, type: "call", price: 1.2, delta: 0.15, oi: 100 }, // candidato short
  { strike: 120, type: "call", price: 0.7, delta: 0.1, oi: 100 }, // ala
];

const walls = {
  supports: [{ price: 85, strength: 70 }],
  resistances: [{ price: 115, strength: 60 }],
};

describe("suggestCreditSpreads — bull put", () => {
  const { putSpread } = suggestCreditSpreads(quotes, 100, walls, 10, {
    targetDelta: 0.2,
    width: 5,
  });

  it("elige el short por delta objetivo, fuera de 1σ", () => {
    expect(putSpread).not.toBeNull();
    expect(putSpread!.shortStrike).toBe(85); // 90 queda dentro de 1σ (90) y |Δ|>0.20
    expect(putSpread!.longStrike).toBe(80);
  });

  it("calcula crédito, máx pérdida, break-even, R/R y prob OTM", () => {
    expect(putSpread!.credit).toBeCloseTo(0.5, 5); // 1.2 - 0.7
    expect(putSpread!.width).toBe(5);
    expect(putSpread!.maxLoss).toBe(450); // (5 - 0.5) * 100
    expect(putSpread!.breakeven).toBeCloseTo(84.5, 5); // 85 - 0.5
    expect(putSpread!.probOTM).toBe(85); // (1 - 0.15) * 100
    expect(putSpread!.riskReward).toBeCloseTo(0.11, 2); // 50 / 450
  });

  it("reporta la fuerza del muro más cercano al short", () => {
    expect(putSpread!.shortWallStrength).toBe(70);
  });
});

describe("suggestCreditSpreads — bear call", () => {
  const { callSpread } = suggestCreditSpreads(quotes, 100, walls, 10, {
    targetDelta: 0.2,
    width: 5,
  });

  it("elige el short call correcto y arma el spread", () => {
    expect(callSpread!.shortStrike).toBe(115);
    expect(callSpread!.longStrike).toBe(120);
    expect(callSpread!.credit).toBeCloseTo(0.5, 5);
    expect(callSpread!.breakeven).toBeCloseTo(115.5, 5); // 115 + 0.5
    expect(callSpread!.probOTM).toBe(85);
    expect(callSpread!.shortWallStrength).toBe(60);
  });
});

describe("suggestCreditSpreads — iron condor y bordes", () => {
  it("arma el iron condor cuando ambos lados existen", () => {
    const r = suggestCreditSpreads(quotes, 100, walls, 10, { targetDelta: 0.2, width: 5 });
    expect(r.ironCondor).not.toBeNull();
    expect(r.ironCondor!.put.shortStrike).toBe(85);
    expect(r.ironCondor!.call.shortStrike).toBe(115);
  });

  it("devuelve null cuando ningún strike cumple el delta objetivo", () => {
    const r = suggestCreditSpreads(quotes, 100, walls, 10, { targetDelta: 0.01, width: 5 });
    expect(r.putSpread).toBeNull();
    expect(r.callSpread).toBeNull();
    expect(r.ironCondor).toBeNull();
  });

  it("no sugiere strikes DENTRO del move de 1σ (evento grande)", () => {
    // con 1σ enorme (40%), el borde put baja a 60 → 85/80/75 quedan dentro → sin candidato
    const r = suggestCreditSpreads(quotes, 100, walls, 40, { targetDelta: 0.2, width: 5 });
    expect(r.putSpread).toBeNull();
  });
});

describe("suggestHedge — put/call de protección (seguro de cola)", () => {
  const puts: OptionQuote[] = [
    { strike: 90, type: "put", price: 2.0, delta: -0.2, oi: 100 },
    { strike: 85, type: "put", price: 1.2, delta: -0.12, oi: 100 }, // ~target delta
    { strike: 80, type: "put", price: 0.7, delta: -0.08, oi: 100 },
    { strike: 75, type: "put", price: 0.4, delta: -0.05, oi: 100 },
  ];

  it("elige el put más cercano al delta objetivo (0.12) debajo del ala larga", () => {
    const h = suggestHedge(puts, "bull_put", 88, 100, 95);
    expect(h?.strike).toBe(85);
    expect(h?.legType).toBe("put");
    expect(h?.cost).toBeCloseTo(1.2, 5);
    expect(h?.costTotal).toBe(120);
    expect(h?.delta).toBeCloseTo(0.12, 5);
    expect(h?.distancePct).toBeCloseTo(15, 5); // (100−85)/100
    expect(h?.inAccelZone).toBe(true); // 85 ≤ flip 95
  });

  it("marca fuera de la zona de aceleración si el strike queda arriba del flip", () => {
    const h = suggestHedge(puts, "bull_put", 88, 100, 80); // flip 80 → 85 > 80
    expect(h?.inAccelZone).toBe(false);
  });

  it("bear_call: elige un call arriba del ala larga, en zona de aceleración", () => {
    const calls: OptionQuote[] = [
      { strike: 110, type: "call", price: 2.0, delta: 0.2, oi: 100 },
      { strike: 115, type: "call", price: 1.2, delta: 0.12, oi: 100 },
      { strike: 120, type: "call", price: 0.7, delta: 0.08, oi: 100 },
    ];
    const h = suggestHedge(calls, "bear_call", 112, 100, 105);
    expect(h?.strike).toBe(115);
    expect(h?.legType).toBe("call");
    expect(h?.inAccelZone).toBe(true); // 115 ≥ flip 105
  });

  it("devuelve null si no hay strike más externo que el ala larga", () => {
    expect(suggestHedge(puts, "bull_put", 74, 100, 95)).toBeNull();
  });

  it("sin flip, inAccelZone es false", () => {
    expect(suggestHedge(puts, "bull_put", 88, 100, null)?.inAccelZone).toBe(false);
  });
});
