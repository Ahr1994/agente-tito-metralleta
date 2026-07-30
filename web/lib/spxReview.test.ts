import { describe, it, expect } from "vitest";
import { reviewSpxTrade, summarizeSpxTrades } from "./spxReview";
import type { SpxTrade } from "./spxTradeStore";

function trade(over: Partial<SpxTrade> = {}): SpxTrade {
  return {
    id: "t1",
    savedAt: "2026-07-29T14:00:00Z",
    dte: 0,
    kind: "bull_put",
    shortStrike: 7300,
    longStrike: 7295,
    width: 5,
    credit: 0.9, // $90
    expiration: "2026-07-29",
    spotAtEntry: 7350,
    atmIvAtEntry: 14,
    regimeAtEntry: "positive",
    wallAtEntry: 7300,
    flowLeanAtEntry: "neutral",
    probOTM: 78,
    evMargin: -3,
    ...over,
  };
}

describe("reviewSpxTrade", () => {
  it("bull_put: gana crédito completo si el settlement queda sobre el short", () => {
    const r = reviewSpxTrade(trade(), 7340);
    expect(r.outcome).toBe("win");
    expect(r.realizedPnL).toBe(90);
    expect(r.maxLoss).toBe(410);
  });

  it("bull_put: máx pérdida si el settlement cae bajo el long", () => {
    const r = reviewSpxTrade(trade(), 7280);
    expect(r.outcome).toBe("loss");
    expect(r.realizedPnL).toBe(-410);
  });

  it("bull_put: parcial entre short y long", () => {
    const r = reviewSpxTrade(trade(), 7298); // rompe el short por 2 pts → 90 − 200 = −110
    expect(r.outcome).toBe("partial");
    expect(r.realizedPnL).toBe(-110);
  });

  it("bear_call: gana si el settlement queda bajo el short", () => {
    const r = reviewSpxTrade(
      trade({ kind: "bear_call", shortStrike: 7400, longStrike: 7405 }),
      7380,
    );
    expect(r.outcome).toBe("win");
    expect(r.realizedPnL).toBe(90);
  });

  it("pending si no hay settlement", () => {
    const r = reviewSpxTrade(trade(), null);
    expect(r.outcome).toBe("pending");
    expect(r.realizedPnL).toBeNull();
  });
});

describe("summarizeSpxTrades", () => {
  it("agrega win-rate, P&L y edge vs ProbOTM", () => {
    const reviews = [
      reviewSpxTrade(trade({ id: "a", probOTM: 80 }), 7340), // win +90
      reviewSpxTrade(trade({ id: "b", probOTM: 80 }), 7340), // win +90
      reviewSpxTrade(trade({ id: "c", probOTM: 80 }), 7280), // loss −410
      reviewSpxTrade(trade({ id: "d", probOTM: 80 }), null), // pending
    ];
    const rec = summarizeSpxTrades(reviews);
    expect(rec.total).toBe(4);
    expect(rec.pending).toBe(1);
    expect(rec.closed).toBe(3);
    expect(rec.wins).toBe(2);
    expect(rec.winRate).toBeCloseTo(66.67, 1);
    expect(rec.totalPnL).toBe(-230); // 90+90−410
    expect(rec.avgProbOTM).toBe(80);
    expect(rec.edgeVsProb).toBe(-13); // 67 − 80
  });

  it("todo pending → sin métricas", () => {
    const rec = summarizeSpxTrades([reviewSpxTrade(trade(), null)]);
    expect(rec.closed).toBe(0);
    expect(rec.winRate).toBeNull();
    expect(rec.edgeVsProb).toBeNull();
  });
});
