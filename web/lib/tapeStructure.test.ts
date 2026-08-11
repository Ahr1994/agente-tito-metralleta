import { describe, it, expect } from "vitest";
import { classifyStructure, readTape } from "./tapeStructure";
import type { SpxFlowTrade } from "./spx";

// helper: un trade SPX crudo con defaults sanos
function t(over: Partial<SpxFlowTrade> = {}): SpxFlowTrade {
  return {
    strike: 7800,
    type: "put",
    expiration: "2026-08-10",
    side: "ask",
    rawSide: "ABOVE_ASK",
    price: 48.8,
    premium: 6_100_000,
    size: 1250,
    oi: 593,
    assetPrice: 7751,
    conditionId: 232, // MLET = multi-leg
    timestamp: "2026-08-10T16:59:39Z",
    gamma: null,
    delta: -0.946,
    iv: 0.15,
    ...over,
  };
}

// Construye una StructLeg como lo hace readTape (vía el trade crudo) para probar classifyStructure.
// Reusa readTape con un solo grupo forzado sería frágil; en su lugar exponemos el caso por readTape.

describe("readTape — short sintético deep-ITM (el 7800P real de las 12:59)", () => {
  const trades: SpxFlowTrade[] = [
    // long put 7800 (Aggr.Buy, deep ITM, 97% intrínseco)
    t({ strike: 7800, type: "put", rawSide: "ABOVE_ASK", premium: 6_100_000, price: 48.8, delta: -0.946 }),
    // short call 7800 (Sell, deep OTM, casi worthless) — misma hora y size ⇒ mismo combo
    t({ strike: 7800, type: "call", rawSide: "AT_BID", premium: 21_300, price: 0.17, delta: 0.05 }),
  ];

  it("agrupa las dos patas en UN short sintético", () => {
    const r = readTape(trades, { minPremium: 10_000 });
    const synth = r.structures.find((s) => s.kind === "synthetic_short");
    expect(synth).toBeTruthy();
    expect(synth!.size).toBe(1250);
    expect(synth!.legs).toHaveLength(2);
  });

  it("lee la dirección REAL como bajista por delta neto, no por el premium", () => {
    const r = readTape(trades, { minPremium: 10_000 });
    const synth = r.structures.find((s) => s.kind === "synthetic_short")!;
    expect(synth.bias).toBe("bearish");
    expect(synth.netDelta).toBeLessThan(-1000); // ≈ short 1250 "acciones"
    expect(synth.directionalNotional).toBeGreaterThan(500_000_000); // ~$965M nocional
  });

  it("lo marca ESTRUCTURAL (descuenta el titular) y NO lo cuenta en el flujo limpio", () => {
    const r = readTape(trades, { minPremium: 10_000 });
    const synth = r.structures.find((s) => s.kind === "synthetic_short")!;
    expect(synth.structural).toBe(true);
    // el $6.1M NO ensucia el sesgo limpio
    expect(r.cleanBearish).toBe(0);
    expect(r.cleanBullish).toBe(0);
    expect(r.structuralPremium).toBe(6_100_000 + 21_300);
    // pero el titular ingenuo SÍ lo grita como bajista (para comparar)
    expect(r.rawBearish).toBe(6_100_000 + 21_300);
  });
});

describe("readTape — separa el sintético del signal limpio", () => {
  const trades: SpxFlowTrade[] = [
    // el sintético ruidoso ($6.1M)
    t({ strike: 7800, type: "put", rawSide: "ABOVE_ASK", premium: 6_100_000, price: 48.8, delta: -0.946 }),
    t({ strike: 7800, type: "call", rawSide: "AT_BID", premium: 21_300, price: 0.17, delta: 0.05 }),
    // el 7745P single-leg agresivo ATM — LA señal bajista limpia ($720K)
    t({
      strike: 7745, type: "put", rawSide: "ABOVE_ASK", premium: 720_000, size: 800,
      price: 9, delta: -0.5, assetPrice: 7744.59, conditionId: 0, // SL
      timestamp: "2026-08-10T16:44:50Z",
    }),
  ];

  it("el flujo LIMPIO refleja solo el single-leg ($720K), no el sintético ($6.1M)", () => {
    const r = readTape(trades, { minPremium: 250_000 });
    expect(r.cleanBearish).toBe(720_000);
    expect(r.cleanLean).toBe("bearish");
    // el titular ingenuo suma todo (6.1M + 21.3K + 720K) = alarma exagerada
    expect(r.rawBearish).toBe(6_100_000 + 21_300 + 720_000);
    // el print limpio aparece en topClean; el sintético no
    expect(r.topClean.some((s) => s.legs[0].strike === 7745)).toBe(true);
    expect(r.topClean.some((s) => s.kind === "synthetic_short")).toBe(false);
  });
});

describe("classifyStructure vía readTape — otras estructuras", () => {
  it("single deep-ITM put = estructural (se comporta como acción)", () => {
    const r = readTape(
      [t({ strike: 7800, type: "put", rawSide: "ABOVE_ASK", premium: 300_000, price: 48.8, delta: -0.95, size: 60, conditionId: 0 })],
      { minPremium: 100_000 },
    );
    const s = r.structures[0];
    expect(s.kind).toBe("single");
    expect(s.structural).toBe(true);
    expect(s.legs[0].intrinsicHeavy).toBe(true);
  });

  it("single ATM put single-leg = direccional LIMPIO (no estructural)", () => {
    const r = readTape(
      [t({ strike: 7745, type: "put", rawSide: "ABOVE_ASK", premium: 720_000, price: 9, delta: -0.5, assetPrice: 7744.59, size: 800, conditionId: 0 })],
      { minPremium: 250_000 },
    );
    const s = r.structures[0];
    expect(s.kind).toBe("single");
    expect(s.structural).toBe(false);
    expect(s.bias).toBe("bearish");
  });

  it("long call + short put mismo strike = largo sintético (alcista)", () => {
    const r = readTape(
      [
        t({ strike: 7750, type: "call", rawSide: "ABOVE_ASK", premium: 500_000, price: 40, delta: 0.55 }),
        t({ strike: 7750, type: "put", rawSide: "AT_BID", premium: 480_000, price: 38, delta: -0.45 }),
      ],
      { minPremium: 100_000 },
    );
    const s = r.structures[0];
    expect(s.kind).toBe("synthetic_long");
    expect(s.bias).toBe("bullish");
    expect(s.structural).toBe(true);
  });

  it("long call + long put mismo strike = straddle (VOL, neutral)", () => {
    const r = readTape(
      [
        t({ strike: 7750, type: "call", rawSide: "ABOVE_ASK", premium: 500_000, price: 40, delta: 0.5 }),
        t({ strike: 7750, type: "put", rawSide: "ABOVE_ASK", premium: 480_000, price: 38, delta: -0.5 }),
      ],
      { minPremium: 100_000 },
    );
    const s = r.structures[0];
    expect(s.kind).toBe("straddle");
    expect(s.bias).toBe("neutral");
    expect(s.structural).toBe(true);
  });

  it("dos puts direcciones opuestas = vertical (direccional, NO estructural)", () => {
    const r = readTape(
      [
        t({ strike: 7700, type: "put", rawSide: "ABOVE_ASK", premium: 400_000, price: 12, delta: -0.3 }),
        t({ strike: 7690, type: "put", rawSide: "AT_BID", premium: 250_000, price: 8, delta: -0.22 }),
      ],
      { minPremium: 100_000 },
    );
    const s = r.structures[0];
    expect(s.kind).toBe("vertical");
    expect(s.structural).toBe(false);
    expect(s.bias).toBe("bearish"); // long put arriba, short put abajo = bear put spread
  });

  it("VENTA agresiva de put OTM = muro de soporte (0DTE), no ensucia direccional", () => {
    const r = readTape(
      [t({ strike: 7700, type: "put", rawSide: "BELOW_BID", premium: 1_000_000, price: 12, delta: -0.18, size: 500 })],
      { minPremium: 250_000 },
    );
    expect(r.premiumWalls).toHaveLength(1);
    const w = r.premiumWalls[0];
    expect(w).toMatchObject({ strike: 7700, type: "put", wall: "soporte", netSold: 1_000_000, aggrSold: 1_000_000 });
    expect(r.premiumSellPut).toBe(1_000_000);
    expect(r.cleanBullish).toBe(0); // la venta de put NO se cuenta como "compra alcista"
  });

  it("NETEA ventas vs compras del mismo strike (flujo de dos lados = muro chico)", () => {
    const r = readTape(
      [
        t({ strike: 7700, type: "put", rawSide: "AT_BID", premium: 1_000_000, price: 12, delta: -0.18, size: 500 }),
        t({ strike: 7700, type: "put", rawSide: "AT_ASK", premium: 800_000, price: 12, delta: -0.18, size: 400 }),
      ],
      { minPremium: 100_000 },
    );
    expect(r.premiumWalls[0].netSold).toBe(200_000); // 1M vendido − 0.8M comprado
    expect(r.premiumWalls[0].size).toBe(100); // 500 − 400
  });

  it("VENTA de call OTM = muro de resistencia", () => {
    const r = readTape(
      [t({ strike: 7850, type: "call", rawSide: "AT_BID", premium: 600_000, price: 5, delta: 0.15 })],
      { minPremium: 250_000 },
    );
    expect(r.premiumWalls[0]).toMatchObject({ strike: 7850, type: "call", wall: "resistencia" });
    expect(r.premiumSellCall).toBe(600_000);
  });

  it("filtra por DTE: un put-write a 38 días NO es muro para 0DTE", () => {
    const near = readTape(
      [t({ strike: 7700, type: "put", rawSide: "AT_BID", premium: 1_000_000, expiration: "2026-08-10", size: 500 })],
      { minPremium: 250_000, maxDte: 0, now: new Date("2026-08-10T16:00:00Z") },
    );
    expect(near.premiumWalls).toHaveLength(1);
    const far = readTape(
      [t({ strike: 7700, type: "put", rawSide: "AT_BID", premium: 1_000_000, expiration: "2026-09-18", size: 500 })],
      { minPremium: 250_000, maxDte: 0, now: new Date("2026-08-10T16:00:00Z") },
    );
    expect(far.premiumWalls).toHaveLength(0); // 38 días, fuera del plazo 0DTE
  });

  it("put comprado LEJOS (12% OTM) = hedge de cola, va a hedgePremium NO a cleanBearish", () => {
    const r = readTape(
      [t({ strike: 6800, type: "put", rawSide: "ABOVE_ASK", premium: 580_000, price: 5, delta: -0.1, size: 80 })],
      { minPremium: 250_000 },
    );
    const s = r.structures[0];
    expect(s.role).toBe("hedge");
    expect(s.otmPct).toBeGreaterThan(0.1);
    expect(r.hedgePremium).toBe(580_000);
    expect(r.cleanBearish).toBe(0); // el hedge lejano no cuenta como convicción bajista
  });

  it("put comprado CERCA del dinero = direccional (sí cuenta como bearish limpio)", () => {
    const r = readTape(
      [t({ strike: 7700, type: "put", rawSide: "ABOVE_ASK", premium: 1_500_000, price: 20, delta: -0.4, size: 750 })],
      { minPremium: 250_000 },
    );
    const s = r.structures[0];
    expect(s.role).toBe("directional");
    expect(r.cleanBearish).toBe(1_500_000);
    expect(r.hedgePremium).toBe(0);
  });

  it("vertical DEEP-ITM (box/financiamiento) = estructural, no cuenta como limpio", () => {
    const r = readTape(
      [
        t({ strike: 9500, type: "put", rawSide: "ABOVE_ASK", premium: 280_000, price: 1751, delta: -0.99, assetPrice: 7750 }),
        t({ strike: 9000, type: "put", rawSide: "AT_BID", premium: 260_000, price: 1252, delta: -0.98, assetPrice: 7750 }),
      ],
      { minPremium: 100_000 },
    );
    const s = r.structures[0];
    expect(s.kind).toBe("vertical");
    expect(s.structural).toBe(true); // patas deep-ITM → box/financiamiento
    expect(r.cleanBearish).toBe(0); // no ensucia el flujo limpio
  });
});
