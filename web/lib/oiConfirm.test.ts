import { describe, it, expect } from "vitest";
import { detectOpeningCandidates, confirmOpening, type FlowPrint, type OpeningCandidate } from "./oiConfirm";

function p(over: Partial<FlowPrint> = {}): FlowPrint {
  return {
    strike: 18,
    type: "call",
    expiration: "2027-01-15",
    rawSide: "AT_ASK",
    size: 30000,
    premium: 10_500_000,
    oi: 5281,
    timestamp: "2026-08-10T19:20:44Z",
    delta: 0.57,
    ...over,
  };
}

describe("detectOpeningCandidates", () => {
  it("detecta la compra grande de calls como candidato alcista de apertura", () => {
    const cands = detectOpeningCandidates([p()]);
    expect(cands).toHaveLength(1);
    expect(cands[0].intent).toBe("bullish");
    expect(cands[0].size).toBe(30000);
    expect(cands[0].sizeVsOi).toBeGreaterThan(1); // 30000 / 5281
  });

  it("agrupa varios prints del mismo contrato+dirección", () => {
    const cands = detectOpeningCandidates([
      p({ size: 20000, premium: 7_000_000 }),
      p({ size: 10000, premium: 3_500_000, timestamp: "2026-08-10T19:20:45Z" }),
    ]);
    expect(cands).toHaveLength(1);
    expect(cands[0].size).toBe(30000);
  });

  it("una VENTA grande de puts = candidato alcista (put-writing)", () => {
    const cands = detectOpeningCandidates([
      p({ type: "put", strike: 40, rawSide: "AT_BID", size: 5000, premium: 3_000_000, oi: 800 }),
    ]);
    expect(cands[0].intent).toBe("bullish");
  });

  it("ignora prints chicos o mid (no direccionales / no institucionales)", () => {
    expect(detectOpeningCandidates([p({ size: 50, premium: 20_000, oi: 5000 })])).toHaveLength(0);
    expect(detectOpeningCandidates([p({ rawSide: "MIDMKT" })])).toHaveLength(0);
  });

  it("exige que el size sea relevante vs el OI previo (posición nueva)", () => {
    // size 500 vs OI 100000 = 0.5% → no parece apertura relevante
    const cands = detectOpeningCandidates([p({ size: 500, premium: 600_000, oi: 100000 })]);
    expect(cands).toHaveLength(0);
  });
});

describe("confirmOpening — el caso WULF (fantasma)", () => {
  const cand: OpeningCandidate = {
    key: "18|call|2027-01-15",
    strike: 18, type: "call", expiration: "2027-01-15",
    side: "Buy", intent: "bullish", size: 30000, premium: 10_500_000,
    oiAtTrade: 5281, timestamp: "2026-08-10T19:20:44Z", sizeVsOi: 30000 / 5281,
  };

  it("OI plano al día siguiente → NO cuajó (señal falsa)", () => {
    const r = confirmOpening(cand, 5180); // WULF real: OI bajó
    expect(r.verdict).toBe("not_confirmed");
    expect(r.deltaOi).toBe(5180 - 5281);
    expect(r.note).toContain("SEÑAL FALSA");
    expect(r.note).toContain("imposible que fuera cierre normal"); // size > OI total
  });

  it("OI sube ~el tamaño del print → CUAJÓ (posición real)", () => {
    const r = confirmOpening(cand, 5281 + 28000); // creció ~28k de los 30k
    expect(r.verdict).toBe("confirmed");
    expect(r.confirmedPct).toBeGreaterThan(0.9);
    expect(r.label).toBe("✅ cuajó");
  });

  it("OI sube ~la mitad → parcial", () => {
    const r = confirmOpening(cand, 5281 + 12000); // 40% de 30k
    expect(r.verdict).toBe("partial");
  });

  it("sin OI de confirmación aún → pending", () => {
    const r = confirmOpening(cand, null);
    expect(r.verdict).toBe("pending");
    expect(r.currentOi).toBeNull();
  });
});
