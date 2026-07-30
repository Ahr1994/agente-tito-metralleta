import { describe, it, expect } from "vitest";
import { spxIvRank, type SpxIvPoint } from "./spxIvStore";

const pts = (vals: number[]): SpxIvPoint[] => vals.map((atmIv, i) => ({ date: `2026-07-${i + 1}`, atmIv }));

describe("spxIvRank", () => {
  it("devuelve insuficiente con <5 fotos", () => {
    const r = spxIvRank(pts([0.1, 0.12, 0.14]), 0.13);
    expect(r.source).toBe("insufficient");
    expect(r.value).toBeNull();
    expect(r.samples).toBe(3);
  });

  it("rankea la IV actual dentro del rango con ≥5 fotos", () => {
    const r = spxIvRank(pts([0.1, 0.12, 0.14, 0.16, 0.2]), 0.15);
    expect(r.source).toBe("history");
    expect(r.value).toBeCloseTo(50); // (0.15-0.10)/(0.20-0.10) = 50%
    expect(r.samples).toBe(5);
  });

  it("insuficiente si la IV actual es null", () => {
    expect(spxIvRank(pts([0.1, 0.12, 0.14, 0.16, 0.2]), null).value).toBeNull();
  });
});
