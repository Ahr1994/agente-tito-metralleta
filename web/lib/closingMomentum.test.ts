import { describe, it, expect } from "vitest";
import { closingMomentumSignal, minutesToClose, aggressiveFlow, type ClosingMomentumInput } from "./closingMomentum";

// 2026-08-03 es lunes. 19:00 UTC = 15:00 ET (60 min al cierre, dentro de la ventana 2h).
const IN_WINDOW = new Date("2026-08-03T19:00:00Z");
const EARLY = new Date("2026-08-03T15:00:00Z"); // 11:00 ET, fuera de la ventana

function base(over: Partial<ClosingMomentumInput> = {}): ClosingMomentumInput {
  return {
    now: IN_WINDOW,
    spot: 7500,
    netGex: -2_000_000_000, // gamma negativa
    gammaFlip: 7490,
    callWall: 7550,
    putWall: 7450,
    magnet: 7500,
    aggBullPremium: 0,
    aggBearPremium: 0,
    ...over,
  };
}

describe("minutesToClose", () => {
  it("15:00 ET → 60 min; fin de semana → null", () => {
    expect(minutesToClose(IN_WINDOW)).toBe(60);
    expect(minutesToClose(new Date("2026-08-01T19:00:00Z"))).toBeNull(); // sábado
  });
});

describe("aggressiveFlow", () => {
  const now = new Date("2026-08-03T19:00:00Z");
  const t = (type: "call" | "put", rawSide: string, premium: number, minsAgo = 5) => ({
    type,
    rawSide,
    premium,
    timestamp: new Date(now.getTime() - minsAgo * 60_000).toISOString(),
  });
  it("compras agresivas de calls = alcista; ignora no-agresivos y viejos", () => {
    const f = aggressiveFlow(
      [
        t("call", "ABOVE_ASK", 1_000_000), // aggr buy call → bull
        t("put", "BELOW_BID", 500_000), // aggr sell put → bull
        t("put", "ABOVE_ASK", 300_000), // aggr buy put → bear
        t("call", "AT_ASK", 900_000), // no agresivo → ignora
        t("call", "ABOVE_ASK", 999_999, 45), // viejo (>30min) → ignora
      ],
      now,
    );
    expect(f.aggBullPremium).toBe(1_500_000);
    expect(f.aggBearPremium).toBe(300_000);
    expect(f.count).toBe(3);
  });
});

describe("closingMomentumSignal", () => {
  it("MOMENTUM ALCISTA: gamma negativa + flujo agresivo de calls → target callWall", () => {
    const s = closingMomentumSignal(base({ aggBullPremium: 5_000_000, aggBearPremium: 500_000 }));
    expect(s.active).toBe(true);
    expect(s.setup).toBe("momentum");
    expect(s.bias).toBe("long");
    expect(s.target).toBe(7550); // callWall arriba
    expect(s.conviction).toBeGreaterThan(50);
  });

  it("MOMENTUM BAJISTA: gamma negativa + flujo agresivo de puts → target putWall", () => {
    const s = closingMomentumSignal(base({ aggBullPremium: 400_000, aggBearPremium: 4_000_000 }));
    expect(s.setup).toBe("momentum");
    expect(s.bias).toBe("short");
    expect(s.target).toBe(7450); // putWall abajo
  });

  it("BREAKOUT: gamma positiva pero el precio rompe el muro de calls con flujo → long", () => {
    const s = closingMomentumSignal(
      base({ netGex: 3_000_000_000, spot: 7551, callWall: 7550, magnet: 7580, aggBullPremium: 4_000_000, aggBearPremium: 300_000 }),
    );
    expect(s.regime).toBe("positive");
    expect(s.setup).toBe("breakout");
    expect(s.bias).toBe("long");
    expect(s.target).toBe(7580); // imán arriba como siguiente nivel
  });

  it("gamma positiva sin romper muro → sin setup", () => {
    const s = closingMomentumSignal(
      base({ netGex: 3_000_000_000, spot: 7500, aggBullPremium: 4_000_000, aggBearPremium: 300_000 }),
    );
    expect(s.regime).toBe("positive");
    expect(s.setup).toBe("none");
    expect(s.bias).toBe("none");
  });

  it("flujo mixto (bajo el umbral) → sin dirección", () => {
    const s = closingMomentumSignal(base({ aggBullPremium: 1_000_000, aggBearPremium: 950_000 }));
    expect(s.bias).toBe("none");
    expect(s.setup).toBe("none");
  });

  it("GEX viejo → capa la convicción y avisa (salvaguarda)", () => {
    const fresh = closingMomentumSignal(
      base({ aggBullPremium: 5_000_000, aggBearPremium: 300_000, gexAt: new Date(IN_WINDOW.getTime() - 5 * 60_000).toISOString() }),
    );
    const stale = closingMomentumSignal(
      base({ aggBullPremium: 5_000_000, aggBearPremium: 300_000, gexAt: new Date(IN_WINDOW.getTime() - 90 * 60_000).toISOString() }),
    );
    expect(fresh.gexStale).toBe(false);
    expect(stale.gexStale).toBe(true);
    expect(stale.gexAgeMin).toBe(90);
    expect(stale.conviction).toBeLessThanOrEqual(25); // capado
    expect(stale.conviction).toBeLessThan(fresh.conviction);
    expect(stale.headline).toMatch(/GEX viejo/i);
  });

  it("fuera de la ventana (mañana) → inactivo, sin setup", () => {
    const s = closingMomentumSignal(base({ now: EARLY, aggBullPremium: 5_000_000, aggBearPremium: 100_000 }));
    expect(s.active).toBe(false);
    expect(s.setup).toBe("none");
    expect(s.headline).toMatch(/fuera de la ventana/i);
  });
});
