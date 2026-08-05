"use client";

import { useCallback, useEffect, useState } from "react";
import NavTabs from "@/app/components/NavTabs";
import type {
  SpxAnalysis,
  SpxDteSetup,
  SpxReviewResult,
  SpxWallBacktestResult,
  SpxClosingFlowResult,
  SpxMonitorResult,
  SpxTapeResult,
  SpxMag7Result,
  SpxMomentumResult,
} from "@/lib/spxServer";
import type { MonitorAction } from "@/lib/positionMonitor";
import type { Mag7Lean } from "@/lib/mag7";

const MAG7_COLOR: Record<Mag7Lean, string> = {
  strong_bullish: "#12b76a",
  bullish: "#12b76a",
  neutral: "#667085",
  bearish: "#f04438",
  strong_bearish: "#f04438",
};

const etTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
};

const ACTION_STYLE: Record<MonitorAction, { color: string; bg: string; label: string }> = {
  hold: { color: "#12b76a", bg: "#ecfdf3", label: "AGUANTA" },
  take_profit: { color: "#175cd3", bg: "#eff8ff", label: "CERRAR (profit)" },
  watch: { color: "#b54708", bg: "#fffaeb", label: "VIGILA" },
  exit: { color: "#b42318", bg: "#fef3f2", label: "EVALÚA SALIR" },
};
import { sizeSpxPosition, type SpxExtreme } from "@/lib/spx";
import type { SpxTrade } from "@/lib/spxTradeStore";
import type { SpxOutcome } from "@/lib/spxReview";

const fmtM = (n: number) => `$${(n / 1e6).toFixed(n >= 1e6 ? 2 : 1)}M`;

const EDGE_COLOR: Record<"go" | "meh" | "wait", string> = {
  go: "#12b76a",
  meh: "#d9a406",
  wait: "#f04438",
};

const OUTCOME: Record<SpxOutcome, { label: string; color: string }> = {
  win: { label: "✅ OTM (ganó)", color: "#12b76a" },
  loss: { label: "❌ máx pérdida", color: "#f04438" },
  partial: { label: "◑ parcial", color: "#d9a406" },
  pending: { label: "⏳ abierto", color: "#98a2b3" },
};

function evBadge(margin: number): { label: string; color: string } {
  if (margin >= 3) return { label: `EV +${margin} ✅`, color: "#12b76a" };
  if (margin >= -2) return { label: `EV ${margin >= 0 ? "+" : ""}${margin} ➖`, color: "#d9a406" };
  return { label: `EV ${margin} ⚠️`, color: "#f04438" };
}

function ExtremeCard({
  ex,
  dte,
  setup,
  budget,
  onSave,
}: {
  ex: SpxExtreme;
  dte: 0 | 1;
  setup: SpxDteSetup["setup"];
  budget: number;
  onSave: (t: Partial<SpxTrade>) => void;
}) {
  const s = ex.spread;
  const ev = evBadge(ex.evMargin);
  const size = sizeSpxPosition(s.credit, s.maxLoss, budget);
  const sideLabel = ex.side === "put" ? "PUT · Bull Put (vender abajo)" : "CALL · Bear Call (vender arriba)";
  return (
    <div
      style={{
        border: ex.recommended ? "2px solid #12b76a" : "1px solid #e4e7ec",
        borderRadius: 12,
        padding: 14,
        background: "#fff",
        flex: "1 1 300px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ color: ex.side === "put" ? "#f04438" : "#12b76a" }}>
          {ex.recommended && "⭐ "}
          {sideLabel}
        </b>
        <span style={{ color: ev.color, fontWeight: 700, fontSize: "0.9em" }}>{ev.label}</span>
      </div>
      <div style={{ fontSize: "1.5em", fontWeight: 800, margin: "8px 0" }}>
        {s.shortStrike} / {s.longStrike}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: "0.92em" }}>
        <span>Crédito: <b>${(s.credit * 100).toFixed(0)}</b></span>
        <span>Delta: <b>{ex.shortDelta != null ? ex.shortDelta.toFixed(2) : "—"}</b></span>
        <span>Máx pérdida: <b>${s.maxLoss}</b></span>
        <span>ProbOTM: <b>{s.probOTM}%</b></span>
        <span>R/R: <b>{s.riskReward}</b></span>
        <span className="muted">BE-win: {ex.breakevenWinPct}%</span>
        <span className="muted">
          Ancla: {ex.anchor === "wall" ? "muro GEX" : ex.anchor === "credit" ? "prima" : ex.anchor}
        </span>
      </div>
      <div
        style={{
          marginTop: 8,
          padding: "6px 8px",
          background: "#f2f4f7",
          borderRadius: 8,
          fontSize: "0.86em",
        }}
      >
        📦 Tu tamaño (colateral ${(budget ?? 0).toLocaleString()}):{" "}
        <b>{size.contracts} spreads</b> → crédito <b style={{ color: "#12b76a" }}>${size.totalCredit}</b>
        {" · "}colateral <b>${(size.totalCollateral ?? 0).toLocaleString()}</b>
      </div>
      {ex.hedge && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 8px",
            background: setup.fragileGamma ? "#fef3f2" : "#f2f4f7",
            border: setup.fragileGamma ? "1px solid #fda29b" : "none",
            borderRadius: 8,
            fontSize: "0.86em",
          }}
        >
          🛡️ Hedge de capital{" "}
          <b style={{ color: setup.fragileGamma ? "#f04438" : "#667085" }}>
            {setup.fragileGamma ? "(recomendado hoy — gamma frágil)" : "(opcional — pin fuerte)"}
          </b>
          : compra{" "}
          <b>
            1× {ex.hedge.strike} {ex.hedge.legType === "put" ? "PUT" : "CALL"}
          </b>{" "}
          por ~<b>${ex.hedge.costTotal}</b> (Δ{ex.hedge.delta}, {ex.hedge.distancePct}%{" "}
          {ex.side === "put" ? "abajo" : "arriba"})
          {ex.hedge.inAccelZone && " · en zona de aceleración ✅"}
          <div className="muted" style={{ fontSize: "0.92em", marginTop: 2 }}>
            ratio 5:1 — 1 hedge por cada ~5 spreads · capa la pérdida ante un movimiento rápido
          </div>
        </div>
      )}
      <button
        className="rescan"
        style={{ marginTop: 10, width: "100%" }}
        onClick={() =>
          onSave({
            dte,
            kind: s.kind,
            shortStrike: s.shortStrike,
            longStrike: s.longStrike,
            width: s.width,
            credit: s.credit,
            expiration: setup.expiration,
            spotAtEntry: setup.spot,
            atmIvAtEntry: setup.atmIv != null ? Math.round(setup.atmIv * 1000) / 10 : null,
            regimeAtEntry: setup.gex.regime,
            wallAtEntry: ex.wall,
            flowLeanAtEntry: setup.bias.lean,
            probOTM: s.probOTM,
            evMargin: ex.evMargin,
          })
        }
      >
        ⭐ Guardar este spread
      </button>
    </div>
  );
}

function DteView({
  d,
  budget,
  onSave,
}: {
  d: SpxDteSetup;
  budget: number;
  onSave: (t: Partial<SpxTrade>) => void;
}) {
  const { setup } = d;
  const g = setup.gex;
  return (
    <div>
      <section className="scorecard" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
          <div>
            <div className="muted" style={{ fontSize: "0.8em" }}>Régimen gamma</div>
            <b style={{ color: g.regime === "positive" ? "#12b76a" : "#f04438" }}>
              {g.regime === "positive" ? "γ+ (pinnea)" : "γ− (amplifica)"}
            </b>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.8em" }}>Muro puts (soporte)</div>
            <b>{g.putWall ?? "—"}</b>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.8em" }}>Imán</div>
            <b>{g.magnet ?? "—"}</b>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.8em" }}>Muro calls (resistencia)</div>
            <b>{g.callWall ?? "—"}</b>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.8em" }}>Flip gamma</div>
            <b>{g.flip ?? "—"}</b>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <div className="muted" style={{ fontSize: "0.8em" }}>Flujo agresivo</div>
            <b
              style={{
                color:
                  setup.bias.lean === "bullish"
                    ? "#12b76a"
                    : setup.bias.lean === "bearish"
                      ? "#f04438"
                      : "#667085",
              }}
            >
              {setup.bias.lean} ({setup.bias.netPct.toFixed(0)}%) → vender {setup.bias.sellSide}
            </b>
          </div>
        </div>
        <div className="muted" style={{ fontSize: "0.82em", marginTop: 8 }}>
          Move diario 1σ: ±{setup.sigma1Pct.toFixed(2)}% (±{((setup.sigma1Pct / 100) * setup.spot).toFixed(0)} pts) ·
          {" "}{d.contracts} contratos en la cadena
        </div>
      </section>

      {setup.extremes.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {setup.extremes.map((ex) => (
            <ExtremeCard key={ex.side} ex={ex} dte={d.dte} setup={setup} budget={budget} onSave={onSave} />
          ))}
        </div>
      ) : (
        <div className="muted">No hay extremos con datos suficientes en esta expiración.</div>
      )}
    </div>
  );
}

export default function SpxPage() {
  const [data, setData] = useState<SpxAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dte, setDte] = useState<0 | 1>(0);
  const [review, setReview] = useState<SpxReviewResult | null>(null);
  const [backtest, setBacktest] = useState<SpxWallBacktestResult | null>(null);
  const [closing, setClosing] = useState<SpxClosingFlowResult | null>(null);
  const [monitor, setMonitor] = useState<SpxMonitorResult | null>(null);
  const [monitorAt, setMonitorAt] = useState<number | null>(null);
  const [tape, setTape] = useState<SpxTapeResult | null>(null);
  const [tapeAt, setTapeAt] = useState<number | null>(null);
  const [mag7, setMag7] = useState<SpxMag7Result | null>(null);
  const [momentum, setMomentum] = useState<SpxMomentumResult | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [mode, setMode] = useState<"delta" | "prima">("prima");
  const [cMin, setCMin] = useState(70);
  const [cMax, setCMax] = useState(100);
  const [budget, setBudget] = useState(2000);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const qs =
        mode === "prima"
          ? `?width=5&creditMin=${(cMin / 100).toFixed(2)}&creditMax=${(cMax / 100).toFixed(2)}`
          : "?width=5";
      const res = await fetch(`/api/spx${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setData(json as SpxAnalysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el SPX.");
    } finally {
      setBusy(false);
    }
  }, [mode, cMin, cMax]);

  const loadReview = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-review", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setReview(json as SpxReviewResult);
    } catch {
      /* ignora */
    }
  }, []);

  const loadBacktest = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-backtest", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setBacktest(json as SpxWallBacktestResult);
    } catch {
      /* ignora */
    }
  }, []);

  const loadClosing = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-closing", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setClosing(json as SpxClosingFlowResult);
    } catch {
      /* ignora */
    }
  }, []);

  const loadMonitor = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-monitor", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setMonitor(json as SpxMonitorResult);
        setMonitorAt(Date.now());
      }
    } catch {
      /* ignora */
    }
  }, []);

  const loadTape = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-tape", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setTape(json as SpxTapeResult);
        setTapeAt(Date.now());
      }
    } catch {
      /* ignora */
    }
  }, []);

  const loadMag7 = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-mag7", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setMag7(json as SpxMag7Result);
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    load();
    loadReview();
    loadBacktest();
    loadClosing();
    loadMonitor();
    loadTape();
    loadMag7();
  }, [load, loadReview, loadBacktest, loadClosing, loadMonitor, loadTape, loadMag7]);

  // Tape institucional + Mag 7 en vivo: refresco cada 45-60s si la pestaña está visible.
  const loadMomentum = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-momentum", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setMomentum(json as SpxMomentumResult);
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    loadMomentum();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadTape();
        loadMag7();
        loadMomentum();
      }
    }, 45_000);
    return () => clearInterval(id);
  }, [loadTape, loadMag7, loadMomentum]);

  // Auto-refresh del monitor cada 60s mientras haya posiciones abiertas y la pestaña esté visible.
  useEffect(() => {
    if (!monitor || monitor.positions.length === 0) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadMonitor();
    }, 60_000);
    return () => clearInterval(id);
  }, [monitor, loadMonitor]);

  const save = useCallback(
    async (t: Partial<SpxTrade>) => {
      try {
        const res = await fetch("/api/spx-trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
        if (res.ok) {
          void loadReview();
          void loadMonitor();
          setFlash(`Guardado: ${t.kind} ${t.shortStrike}/${t.longStrike}`);
          setTimeout(() => setFlash(null), 2500);
        }
      } catch {
        /* ignora */
      }
    },
    [loadReview, loadMonitor],
  );

  const active = data ? (dte === 0 ? data.zero : data.one) : null;

  return (
    <main className="ideas-page">
      <div className="hb">
        <div className="hb-brand">
          <div className="hb-logo">T</div>
          <div className="hb-name">Tito Metralleta</div>
          <div className="hb-chip">SPX · Venta de prima 0DTE/1DTE</div>
        </div>
        <NavTabs />
      </div>

      <div className="ideas-body">
        <section className="scorecard">
          <div className="score-main">
            <div className="score-cat">
              SPX — Extremos safe para vender prima diaria (credit spread)
            </div>
            <div className="score-q">
              Cruza los muros de GEX (dónde el dealer pinnea) + el move esperado + el flujo
              agresivo para darte las colas más defendibles por lado, con su EV.
            </div>
          </div>
          {data && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 12, alignItems: "baseline" }}>
              <div>
                <span className="muted" style={{ fontSize: "0.8em" }}>
                  Spot SPX {data.spotSource === "index" ? (data.indexDelayed ? "(retrasado)" : "(tiempo real ✅)") : "(derivado)"}
                </span>{" "}
                <b style={{ fontSize: "1.2em" }}>${data.spot?.toFixed(1) ?? "—"}</b>
              </div>
              <div>
                <span className="muted" style={{ fontSize: "0.8em" }}>IV ATM</span>{" "}
                <b>{data.atmIv != null ? `${(data.atmIv * 100).toFixed(1)}%` : "—"}</b>
                {data.chainSource === "marketsnack" && (
                  <span style={{ fontSize: "0.7em", color: "#12b76a", marginLeft: 4 }}>real ✅</span>
                )}
              </div>
              <div>
                <span className="muted" style={{ fontSize: "0.8em" }}>IV Rank</span>{" "}
                <b>
                  {data.ivRank.value != null
                    ? `${data.ivRank.value.toFixed(0)} / 100`
                    : `sin datos (${data.ivRank.samples})`}
                </b>
              </div>
            </div>
          )}
        </section>

        {data && (
          <section
            className="scorecard"
            style={{
              marginTop: 12,
              borderLeft: `5px solid ${EDGE_COLOR[data.edge.level]}`,
              background: `${EDGE_COLOR[data.edge.level]}12`,
            }}
          >
            <div style={{ fontSize: "1.05em", fontWeight: 800, color: EDGE_COLOR[data.edge.level] }}>
              {data.edge.headline} <span className="muted" style={{ fontWeight: 500, fontSize: "0.8em" }}>({data.edge.score}/100)</span>
            </div>
            <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
              {data.edge.reasons.join(" · ")}
            </div>
          </section>
        )}

        {momentum && (() => {
          const s = momentum.signal;
          const col = s.setup === "none" ? "#667085" : s.bias === "long" ? "#12b76a" : "#f04438";
          return (
            <section
              className="scorecard"
              style={{
                marginTop: 12,
                borderLeft: `5px solid ${col}`,
                background: s.setup !== "none" ? `${col}12` : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <b style={{ color: col }}>🚀 Direccional de cierre: {s.headline}</b>
                <span className="muted" style={{ fontSize: "0.78em" }}>
                  {s.minutesToClose != null ? `${s.minutesToClose} min al cierre` : "mercado cerrado"} · auto 45s
                </span>
              </div>
              {s.setup !== "none" ? (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8, fontSize: "0.9em" }}>
                    <span>Dirección: <b style={{ color: col }}>{s.bias === "long" ? "📈 LONG" : "📉 SHORT"}</b></span>
                    <span>Target: <b>{s.target}</b> {s.targetPts != null && <span className="muted">({s.targetPts} pts)</span>}</span>
                    <span>Convicción: <b>{s.conviction}/100</b></span>
                    <span className="muted">gamma {s.regime === "negative" ? "γ− (amplifica)" : "γ+ (breakout)"}</span>
                  </div>
                  {s.gexStale && (
                    <div style={{ color: "#b42318", fontWeight: 700, fontSize: "0.82em", marginTop: 4 }}>
                      ⚠ GEX de hace {s.gexAgeMin} min — convicción capada, verifica antes de entrar.
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: "0.82em", marginTop: 6 }}>{s.reasons.join(" · ")}</div>
                </>
              ) : (
                <div className="muted" style={{ fontSize: "0.85em", marginTop: 6 }}>
                  {s.active
                    ? `En ventana, sin move armándose (gamma ${s.regime}, flujo agresivo ${s.flowNetPct >= 0 ? "+" : ""}${s.flowNetPct}%). Para días sin edge de prima.`
                    : "La ventana direccional abre en las últimas 2h (2:00 PM ET). Para cuando NO haya edge de venta de prima."}
                </div>
              )}
            </section>
          );
        })()}

        {mag7 && (
          <section
            className="scorecard"
            style={{
              marginTop: 12,
              borderLeft: `5px solid ${MAG7_COLOR[mag7.breadth.lean]}`,
              background: mag7.breadth.warning ? `${MAG7_COLOR[mag7.breadth.lean]}12` : undefined,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <b style={{ color: MAG7_COLOR[mag7.breadth.lean] }}>🧲 7 Magníficas: {mag7.breadth.headline}</b>
              <span className="muted" style={{ fontSize: "0.8em" }}>
                {mag7.breadth.upCount}↑ / {mag7.breadth.downCount}↓ · prom {mag7.breadth.avgChangePct >= 0 ? "+" : ""}{mag7.breadth.avgChangePct}% · ● auto 60s
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {mag7.breadth.stocks.map((s) => {
                const up = s.changePct != null && s.changePct > 0;
                const col = s.changePct == null ? "#98a2b3" : up ? "#12b76a" : "#f04438";
                return (
                  <span key={s.ticker} style={{ padding: "3px 8px", borderRadius: 6, background: `${col}18`, color: col, fontWeight: 700, fontSize: "0.85em" }}>
                    {s.ticker} {s.changePct == null ? "—" : `${up ? "+" : ""}${s.changePct.toFixed(2)}%`}
                  </span>
                );
              })}
            </div>
            {mag7.breadth.warning && (
              <div style={{ color: MAG7_COLOR[mag7.breadth.lean], fontWeight: 700, fontSize: "0.88em", marginTop: 8 }}>
                ⚠ {mag7.breadth.warning}
              </div>
            )}
          </section>
        )}

        {data?.msGex && (data.msGex.callWall || data.msGex.putWall) && (
          <section className="scorecard" style={{ marginTop: 12, borderLeft: "5px solid #7a5af8" }}>
            <b>🎯 GEX oficial de MarketSnack (plan Indices)</b>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 8 }}>
              <div><div className="muted" style={{ fontSize: "0.78em" }}>Muro puts (soporte)</div><b>{data.msGex.putWall ?? "—"}</b></div>
              <div><div className="muted" style={{ fontSize: "0.78em" }}>Muro calls (resistencia)</div><b>{data.msGex.callWall ?? "—"}</b></div>
              <div><div className="muted" style={{ fontSize: "0.78em" }}>Imán</div><b>{data.msGex.magnet ?? "—"}</b></div>
              <div><div className="muted" style={{ fontSize: "0.78em" }}>Max pain</div><b>{data.msGex.maxPain ?? "—"}</b></div>
              <div><div className="muted" style={{ fontSize: "0.78em" }}>Gamma flip</div><b>{data.msGex.gammaFlip?.toFixed(0) ?? "—"}</b></div>
              <div>
                <div className="muted" style={{ fontSize: "0.78em" }}>Net GEX</div>
                <b style={{ color: (data.msGex.netGex ?? 0) >= 0 ? "#12b76a" : "#f04438" }}>
                  {data.msGex.netGex != null ? `${data.msGex.netGex >= 0 ? "+" : ""}${(data.msGex.netGex / 1e9).toFixed(2)}B` : "—"}
                </b>
              </div>
            </div>
            <div className="muted" style={{ fontSize: "0.78em", marginTop: 6 }}>
              Muros calculados por MarketSnack (más autoritativos que la estimación del agente). Net GEX + = pinnea, − = amplifica.
            </div>
          </section>
        )}

        {data?.daySentiment && (
          <section
            className="scorecard"
            style={{
              marginTop: 12,
              borderLeft: `5px solid ${data.daySentiment.lean === "bullish" ? "#12b76a" : data.daySentiment.lean === "bearish" ? "#f04438" : "#667085"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <b>📈 Sentiment del día (MarketSnack)</b>
              <b style={{ color: data.daySentiment.lean === "bullish" ? "#12b76a" : data.daySentiment.lean === "bearish" ? "#f04438" : "#667085" }}>
                {data.daySentiment.lean.toUpperCase()} ({data.daySentiment.netPct >= 0 ? "+" : ""}{data.daySentiment.netPct.toFixed(0)}%)
              </b>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8, fontSize: "0.88em" }}>
              <span>🟢 Alcista <b>${(data.daySentiment.bullishPremium / 1e9).toFixed(2)}B</b></span>
              <span>🔴 Bajista <b>${(data.daySentiment.bearishPremium / 1e9).toFixed(2)}B</b></span>
              <span className="muted">calls comp ${(data.daySentiment.callsBought / 1e9).toFixed(2)}B · vend ${(data.daySentiment.callsSold / 1e9).toFixed(2)}B</span>
              <span className="muted">puts comp ${(data.daySentiment.putsBought / 1e9).toFixed(2)}B · vend ${(data.daySentiment.putsSold / 1e9).toFixed(2)}B</span>
            </div>
            <div className="muted" style={{ fontSize: "0.78em", marginTop: 6 }}>
              Del día COMPLETO (comprar call / vender put = alcista). Más robusto que la tape reciente.
            </div>
          </section>
        )}

        {data?.freshness.stale && (
          <section
            className="scorecard"
            style={{
              marginTop: 12,
              background: data.freshness.status === "suspect" ? "#fef3f2" : "#fffaeb",
              borderLeft: `5px solid ${data.freshness.status === "suspect" ? "#f04438" : "#f79009"}`,
            }}
          >
            <b style={{ color: data.freshness.status === "suspect" ? "#b42318" : "#b54708" }}>
              {data.freshness.status === "suspect" ? "⚠ Cadena posiblemente rezagada" : "🌙 Mercado cerrado"}
            </b>
            <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>{data.freshness.message}</div>
          </section>
        )}

        {monitor && monitor.positions.length > 0 && (
          <section className="scorecard" style={{ marginTop: 12, border: "2px solid #101828" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>🎯 Monitor de posiciones abiertas</b>
              <span className="muted" style={{ fontSize: "0.78em" }}>
                {monitor.spot != null && (
                  <>
                    spot{" "}
                    <b style={{ color: monitor.spotSource === "derived" ? "#b54708" : "#12b76a" }}>
                      ${monitor.spot.toFixed(1)}
                    </b>{" "}
                    {monitor.spotSource === "tape"
                      ? "(tiempo real ✅)"
                      : monitor.spotSource === "parity"
                        ? "(tiempo real · paridad ✅)"
                        : "(retrasado ⚠)"}{" "}
                    ·{" "}
                  </>
                )}
                <span style={{ color: "#f04438" }}>●</span> en vivo
                {monitorAt && ` · ${Math.round((Date.now() - monitorAt) / 1000)}s` } · auto 60s
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {monitor.positions.map((p) => {
                const st = p.status;
                const a = ACTION_STYLE[st.action];
                return (
                  <div
                    key={p.trade.id}
                    style={{ borderLeft: `5px solid ${a.color}`, background: a.bg, borderRadius: 8, padding: "10px 12px" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                      <b>
                        {p.trade.kind === "bull_put" ? "PUT" : "CALL"} {p.trade.shortStrike}/{p.trade.longStrike} ·{" "}
                        <span className="muted" style={{ fontWeight: 400 }}>vto {p.trade.expiration}</span>
                      </b>
                      <b style={{ color: a.color }}>{st.headline}</b>
                    </div>
                    <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
                      {st.reasons.join(" · ")}
                    </div>
                    {st.adverse && st.action !== "hold" && (
                      <div style={{ color: "#b42318", fontWeight: 700, fontSize: "0.85em", marginTop: 4 }}>
                        ⚠ Está entrando flujo agresivo EN CONTRA de tu venta.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="muted" style={{ fontSize: "0.78em", marginTop: 8 }}>{monitor.note}</div>
          </section>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", margin: "12px 0" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {([0, 1] as const).map((n) => (
              <button
                key={n}
                className="rescan"
                style={{
                  background: dte === n ? "#101828" : undefined,
                  color: dte === n ? "#fff" : undefined,
                }}
                onClick={() => setDte(n)}
              >
                {n}DTE {n === 0 ? (data?.zero?.expiration ?? "") : (data?.one?.expiration ?? "")}
              </button>
            ))}
          </div>
          <button className="rescan" onClick={load} disabled={busy}>
            {busy ? "Cargando…" : "↻ Actualizar"}
          </button>
        </div>

        <section className="scorecard" style={{ padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <b style={{ fontSize: "0.9em" }}>Elegir extremos por:</b>
            <div style={{ display: "flex", gap: 6 }}>
              {(["prima", "delta"] as const).map((m) => (
                <button
                  key={m}
                  className="rescan"
                  style={{ background: mode === m ? "#101828" : undefined, color: mode === m ? "#fff" : undefined }}
                  onClick={() => setMode(m)}
                >
                  {m === "prima" ? "💵 Prima objetivo" : "📐 Delta (muro GEX)"}
                </button>
              ))}
            </div>
            {mode === "prima" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.9em" }}>
                <span className="muted">Prima $</span>
                <input
                  type="number"
                  value={cMin}
                  onChange={(e) => setCMin(Number(e.target.value))}
                  style={{ width: 60, padding: "4px 6px", border: "1px solid #d0d5dd", borderRadius: 6 }}
                />
                <span className="muted">a $</span>
                <input
                  type="number"
                  value={cMax}
                  onChange={(e) => setCMax(Number(e.target.value))}
                  style={{ width: 60, padding: "4px 6px", border: "1px solid #d0d5dd", borderRadius: 6 }}
                />
                <button className="rescan" onClick={load} disabled={busy}>
                  Aplicar
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.9em", marginLeft: "auto" }}>
              <span className="muted">📦 Colateral objetivo $</span>
              <input
                type="number"
                value={budget}
                step={500}
                onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
                style={{ width: 80, padding: "4px 6px", border: "1px solid #d0d5dd", borderRadius: 6 }}
              />
            </div>
          </div>
          <div className="muted" style={{ fontSize: "0.8em", marginTop: 6 }}>
            {mode === "prima"
              ? "Modo como operas tú: busca el spread de 5 puntos que cobra esa prima y queda más cerca del muro de gamma. Te muestra el delta que te toca."
              : "Ancla el short al muro de GEX con tope de delta 0.25 (la cola más defendible)."}
          </div>
        </section>

        {flash && (
          <section className="scorecard" style={{ color: "#12b76a", padding: "8px 12px" }}>✓ {flash}</section>
        )}
        {error && (
          <section className="scorecard" style={{ color: "#f04438" }}>⚠ {error}</section>
        )}
        {data?.flowError && (
          <section className="scorecard" style={{ color: "#b54708", fontSize: "0.9em" }}>
            ⚠ Flujo de MarketSnack no disponible ({data.flowError}). El GEX y los extremos siguen
            calculados; el sesgo de flujo queda neutral.
          </section>
        )}

        {busy && !data && <div className="muted">Cargando cadena SPX…</div>}

        {active ? (
          <DteView d={active} budget={budget} onSave={save} />
        ) : (
          data && !busy && (
            <div className="muted">No hay cadena para {dte}DTE ahora mismo (mercado cerrado o sin vencimiento).</div>
          )
        )}

        {tape && (
          <section className="scorecard" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <b>🏦 Tape institucional SPX</b>
              <span className="muted" style={{ fontSize: "0.78em" }}>
                <span style={{ color: "#12b76a" }}>●</span> live
                {tapeAt && ` · ${Math.round((Date.now() - tapeAt) / 1000)}s` } · auto 45s
              </span>
            </div>
            <div className="muted" style={{ fontSize: "0.82em", marginTop: 2 }}>
              Prints grandes (≥${(tape.minPremium / 1000).toFixed(0)}K) que alimentan la foto de gamma.
            </div>
            {tape.flowError ? (
              <div style={{ color: "#b54708", fontSize: "0.85em", marginTop: 8 }}>⚠ Flujo no disponible ({tape.flowError})</div>
            ) : tape.tape.prints.length === 0 ? (
              <div className="muted" style={{ marginTop: 8 }}>Sin prints institucionales por ahora.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 16, margin: "10px 0", flexWrap: "wrap" }}>
                  <span>Premium capturado: <b>${(tape.tape.premiumTotal / 1e6).toFixed(0)}M</b> <span className="muted">({tape.tape.count} prints)</span></span>
                  <span>
                    Sesgo:{" "}
                    <b style={{ color: tape.tape.lean === "bullish" ? "#12b76a" : tape.tape.lean === "bearish" ? "#f04438" : "#667085" }}>
                      {tape.tape.lean}
                    </b>{" "}
                    <span className="muted">(${(tape.tape.bullishPremium / 1e6).toFixed(0)}M alcista / ${(tape.tape.bearishPremium / 1e6).toFixed(0)}M bajista)</span>
                  </span>
                </div>
                <div style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {tape.tape.prints.map((p, i) => {
                    const buy = p.side === "Buy" || p.side === "Aggr.Buy";
                    const sideColor = buy ? "#12b76a" : p.side === "Mid" ? "#667085" : "#f04438";
                    return (
                      <div
                        key={i}
                        style={{
                          borderLeft: `4px solid ${p.bullish ? "#12b76a" : "#f04438"}`,
                          background: "#f9fafb",
                          borderRadius: 6,
                          padding: "6px 10px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "0.88em",
                        }}
                      >
                        <span>
                          <b>{p.strike}{p.type === "put" ? "P" : "C"}</b>{" "}
                          <span style={{ color: sideColor, fontWeight: 700 }}>{p.side}</span>{" "}
                          <span className="muted">· {p.cond}</span>
                        </span>
                        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <b>${p.premium >= 1e6 ? `${(p.premium / 1e6).toFixed(1)}M` : `${(p.premium / 1e3).toFixed(0)}K`}</b>
                          <span className="muted">×{p.size}</span>
                          <span className="muted" style={{ fontSize: "0.85em" }}>{etTime(p.timestamp)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {data && data.news.length > 0 && (
          <section className="scorecard" style={{ marginTop: 14 }}>
            <b>📰 Noticias macro</b>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {data.news.map((n, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "#175cd3" }}>
                    {n.title}
                  </a>{" "}
                  <span className="muted" style={{ fontSize: "0.82em" }}>· {n.publisher}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {review && review.record.closed > 0 && (
          <section className="scorecard" style={{ marginTop: 14 }}>
            <b>🏆 Tu track record real ({review.record.closed} cerrados)</b>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginTop: 10 }}>
              <div>
                <div className="muted" style={{ fontSize: "0.8em" }}>Win-rate (expiró OTM)</div>
                <b style={{ fontSize: "1.3em" }}>
                  {review.record.winRate?.toFixed(0)}% <span className="muted" style={{ fontSize: "0.6em" }}>({review.record.wins}/{review.record.closed})</span>
                </b>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8em" }}>P&L realizado</div>
                <b style={{ fontSize: "1.3em", color: review.record.totalPnL >= 0 ? "#12b76a" : "#f04438" }}>
                  {review.record.totalPnL >= 0 ? "+" : ""}${review.record.totalPnL}
                </b>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8em" }}>EV real / trade</div>
                <b style={{ fontSize: "1.3em", color: (review.record.realizedEvPerTrade ?? 0) >= 0 ? "#12b76a" : "#f04438" }}>
                  {(review.record.realizedEvPerTrade ?? 0) >= 0 ? "+" : ""}${review.record.realizedEvPerTrade}
                </b>
              </div>
              {review.record.edgeVsProb != null && (
                <div>
                  <div className="muted" style={{ fontSize: "0.8em" }}>Edge vs ProbOTM</div>
                  <b style={{ fontSize: "1.3em", color: review.record.edgeVsProb >= 0 ? "#12b76a" : "#f04438" }}>
                    {review.record.edgeVsProb >= 0 ? "+" : ""}{review.record.edgeVsProb} pts
                  </b>
                  <div className="muted" style={{ fontSize: "0.72em" }}>
                    ganas {review.record.winRate?.toFixed(0)}% vs {review.record.avgProbOTM}% prometido
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {review && review.reviews.length > 0 && (
          <section className="scorecard" style={{ marginTop: 14 }}>
            <b>📌 Tus spreads SPX {review.record.pending > 0 && <span className="muted">({review.record.pending} abiertos)</span>}</b>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>DTE</th>
                    <th>Spread</th>
                    <th className="num">Crédito</th>
                    <th className="num">ProbOTM</th>
                    <th>Resultado</th>
                    <th className="num">P&L</th>
                    <th className="num">Settle</th>
                  </tr>
                </thead>
                <tbody>
                  {review.reviews.map((r) => {
                    const t = r.trade;
                    const o = OUTCOME[r.outcome];
                    return (
                      <tr key={t.id}>
                        <td className="muted">{new Date(t.savedAt).toLocaleDateString()}</td>
                        <td>{t.dte}DTE</td>
                        <td>
                          <b>{t.kind === "bull_put" ? "PUT" : "CALL"}</b> {t.shortStrike}/{t.longStrike}
                        </td>
                        <td className="num">${(t.credit * 100).toFixed(0)}</td>
                        <td className="num">{t.probOTM ?? "—"}%</td>
                        <td style={{ color: o.color, fontWeight: 600 }}>{o.label}</td>
                        <td className="num" style={{ color: r.realizedPnL == null ? undefined : r.realizedPnL >= 0 ? "#12b76a" : "#f04438", fontWeight: 700 }}>
                          {r.realizedPnL == null ? "—" : `${r.realizedPnL >= 0 ? "+" : ""}$${r.realizedPnL}`}
                        </td>
                        <td className="num muted">{r.settlement?.toFixed(0) ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: "0.78em", marginTop: 8 }}>{review.settlementNote}</div>
          </section>
        )}

        {closing && (
          <section className="scorecard" style={{ marginTop: 14 }}>
            <b>🔔 Ventas de prima en el cierre (power hour, 15:30–16:00 ET)</b>
            <div className="muted" style={{ fontSize: "0.82em", marginTop: 4 }}>
              Ventas grandes al bid del vencimiento cercano en la última media hora → confirmadas
              al día siguiente si suben el Open Interest (posición abierta overnight).
            </div>

            {closing.today.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <b style={{ fontSize: "0.9em" }}>Hoy en el cierre:</b>
                <div className="table-wrap" style={{ marginTop: 6 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th className="num">DTE</th>
                        <th className="num">Prima vendida</th>
                        <th className="num">Contratos</th>
                        <th className="num">OI (previo)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closing.today.map((s) => (
                        <tr key={`${s.type}${s.strike}${s.expiration}`}>
                          <td>
                            <b>{s.type === "put" ? "PUT" : "CALL"}</b> {s.strike} · {s.expiration}
                          </td>
                          <td className="num">{s.dte}</td>
                          <td className="num"><b>{fmtM(s.totalPremium)}</b></td>
                          <td className="num">{s.totalSize.toLocaleString()}</td>
                          <td className="num muted">{s.oiAtTrade.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: "0.85em", marginTop: 8 }}>
                {closing.detectedInWindow
                  ? "Sin ventas grandes en el cierre de hoy (bajo el umbral)."
                  : "Aún no es la ventana de cierre (o mercado cerrado). Se llena en la última media hora."}
              </div>
            )}

            {closing.prior && closing.prior.reviews.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <b style={{ fontSize: "0.9em" }}>
                  Confirmación de la sesión anterior ({closing.prior.date}) — ¿se sumaron al OI?
                </b>
                <div className="table-wrap" style={{ marginTop: 6 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th className="num">Prima vendida</th>
                        <th className="num">OI venta</th>
                        <th className="num">OI hoy</th>
                        <th className="num">Δ OI</th>
                        <th>¿Overnight?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closing.prior.reviews.map((r) => (
                        <tr key={`${r.type}${r.strike}${r.expiration}`}>
                          <td>
                            <b>{r.type === "put" ? "PUT" : "CALL"}</b> {r.strike} · {r.expiration}
                          </td>
                          <td className="num">{fmtM(r.totalPremium)}</td>
                          <td className="num muted">{r.oiAtTrade.toLocaleString()}</td>
                          <td className="num">{r.currentOi != null ? r.currentOi.toLocaleString() : "—"}</td>
                          <td className="num" style={{ color: (r.oiChange ?? 0) > 0 ? "#12b76a" : "#f04438", fontWeight: 700 }}>
                            {r.oiChange != null ? `${r.oiChange > 0 ? "+" : ""}${r.oiChange.toLocaleString()}` : "—"}
                          </td>
                          <td style={{ color: r.confirmed ? "#12b76a" : "#98a2b3", fontWeight: 600 }}>
                            {r.confirmed ? "✅ confirmado" : r.currentOi == null ? "sin dato" : "◑ no claro"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="muted" style={{ fontSize: "0.78em", marginTop: 8 }}>{closing.note}</div>
          </section>
        )}

        {backtest && (
          <section className="scorecard" style={{ marginTop: 14 }}>
            <b>🧪 ¿El precio respeta los muros de GEX? ({backtest.sample} sesiones)</b>
            {backtest.sample === 0 ? (
              <div className="muted" style={{ fontSize: "0.85em", marginTop: 6 }}>
                Aún no hay sesiones acumuladas. Cada día que abras esta vista se guarda la foto de
                muros; el backtest se llena solo en unos días.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginTop: 10 }}>
                  <div>
                    <div className="muted" style={{ fontSize: "0.8em" }}>Muro de calls aguantó</div>
                    <b style={{ fontSize: "1.3em", color: (backtest.callHeldRate ?? 0) >= 70 ? "#12b76a" : "#d9a406" }}>
                      {backtest.callHeldRate ?? "—"}%
                    </b>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: "0.8em" }}>Muro de puts aguantó</div>
                    <b style={{ fontSize: "1.3em", color: (backtest.putHeldRate ?? 0) >= 70 ? "#12b76a" : "#d9a406" }}>
                      {backtest.putHeldRate ?? "—"}%
                    </b>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: "0.8em" }}>Ambos aguantaron</div>
                    <b style={{ fontSize: "1.3em" }}>{backtest.bothHeldRate ?? "—"}%</b>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: "0.8em" }}>Cierre vs imán (prom.)</div>
                    <b style={{ fontSize: "1.3em" }}>±{backtest.avgMagnetErrPct ?? "—"}%</b>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: "0.78em", marginTop: 8 }}>{backtest.note}</div>
              </>
            )}
          </section>
        )}

        <div className="muted" style={{ fontSize: "0.8em", marginTop: 12 }}>
          Spot del índice SPX en tiempo real (MarketSnack, plan Indices); si falla, se deriva por paridad. Riesgo definido,
          pero el 0DTE tiene gap/tail risk real. No es consejo financiero.
        </div>
      </div>
    </main>
  );
}
