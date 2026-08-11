import { describe, it, expect } from "vitest";
import { scanPremiumSells, type PremSellPrint } from "./premiumSellScan";

const NOW = new Date("2026-08-11T17:00:00Z");
function p(over: Partial<PremSellPrint> = {}): PremSellPrint {
  return { strike: 7740, type: "call", expiration: "2026-08-11", rawSide: "AT_BID", size: 40, premium: 60_000, ...over };
}

describe("scanPremiumSells", () => {
  it("venden calls (resistencia) + compran puts = lean call_resistance, avisa del piso sin defender", () => {
    const r = scanPremiumSells(
      [
        p({ strike: 7745, type: "call", rawSide: "AT_BID", premium: 90_000 }),
        p({ strike: 7740, type: "call", rawSide: "BELOW_BID", premium: 60_000 }),
        p({ strike: 7730, type: "put", rawSide: "AT_ASK", premium: 80_000 }), // COMPRAN puts
      ],
      7735,
      { now: NOW },
    );
    expect(r.lean).toBe("call_resistance");
    expect(r.callWriting).toBe(150_000);
    expect(r.putBuying).toBe(80_000);
    expect(r.walls.filter((w) => w.type === "call")).toHaveLength(2);
    expect(r.note).toContain("COMPRAN puts");
  });

  it("venden puts OTM = lean put_support (piso alcista)", () => {
    const r = scanPremiumSells(
      [
        p({ strike: 7700, type: "put", rawSide: "AT_BID", premium: 120_000 }),
        p({ strike: 7690, type: "put", rawSide: "BELOW_BID", premium: 80_000 }),
      ],
      7735,
      { now: NOW },
    );
    expect(r.lean).toBe("put_support");
    expect(r.putWriting).toBe(200_000);
    expect(r.walls[0].wall).toBe("soporte");
  });

  it("netea ventas vs compras del mismo strike", () => {
    const r = scanPremiumSells(
      [
        p({ strike: 7700, type: "put", rawSide: "AT_BID", premium: 150_000, size: 100 }),
        p({ strike: 7700, type: "put", rawSide: "AT_ASK", premium: 100_000, size: 60 }),
      ],
      7735,
      { now: NOW, minWall: 10_000 },
    );
    expect(r.walls[0].netSold).toBe(50_000);
    expect(r.walls[0].size).toBe(40);
  });

  it("filtra por DTE: una venta a 38 días NO cuenta para 0-1DTE", () => {
    const r = scanPremiumSells(
      [p({ strike: 7700, type: "put", rawSide: "AT_BID", premium: 200_000, expiration: "2026-09-18" })],
      7735,
      { now: NOW },
    );
    expect(r.considered).toBe(0);
    expect(r.walls).toHaveLength(0);
    expect(r.lean).toBe("quiet");
  });

  it("ignora opciones ITM (solo OTM son muros de venta de prima)", () => {
    const r = scanPremiumSells(
      [p({ strike: 7800, type: "put", rawSide: "AT_BID", premium: 100_000 })], // 7800P con spot 7735 = ITM
      7735,
      { now: NOW },
    );
    expect(r.considered).toBe(0);
  });
});
