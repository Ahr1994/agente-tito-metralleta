import { describe, it, expect } from "vitest";
import { backtestWalls, type DayRange } from "./spxWallBacktest";
import type { SpxGexSnapshot } from "./spxGexStore";

function snap(date: string, putWall: number, callWall: number, magnet: number): SpxGexSnapshot {
  return { date, spot: (putWall + callWall) / 2, putWall, callWall, magnet, regime: "positive" };
}
function range(date: string, low: number, high: number, close: number): DayRange {
  return { date, low, high, close };
}

describe("backtestWalls", () => {
  it("cuenta cuándo los muros contuvieron el rango del día", () => {
    const snaps = [
      snap("2026-07-28", 7300, 7400, 7350), // rango 7320-7390 → ambos aguantan
      snap("2026-07-29", 7300, 7400, 7350), // high 7410 rompe el call; low 7310 aguanta
      snap("2026-07-30", 7300, 7400, 7350), // low 7290 rompe el put; high 7380 aguanta
    ];
    const ranges = [
      range("2026-07-28", 7320, 7390, 7360),
      range("2026-07-29", 7310, 7410, 7405),
      range("2026-07-30", 7290, 7380, 7295),
    ];
    const bt = backtestWalls(snaps, ranges);
    expect(bt.sample).toBe(3);
    expect(bt.callHeldRate).toBe(67); // 2 de 3 (28 y 30)
    expect(bt.putHeldRate).toBe(67); // 2 de 3 (28 y 29)
    expect(bt.bothHeldRate).toBe(33); // solo el 28
    expect(bt.days[0].date).toBe("2026-07-30"); // más reciente primero
  });

  it("ignora días sin rango conocido", () => {
    const bt = backtestWalls([snap("2026-07-28", 7300, 7400, 7350)], []);
    expect(bt.sample).toBe(0);
    expect(bt.callHeldRate).toBeNull();
  });

  it("mide qué tan cerca cerró del imán", () => {
    const bt = backtestWalls(
      [snap("2026-07-28", 7300, 7400, 7350)],
      [range("2026-07-28", 7320, 7390, 7357)], // cierre 7357 vs imán 7350 → 0.098%
    );
    expect(bt.avgMagnetErrPct).toBeCloseTo(0.1, 1);
  });
});
