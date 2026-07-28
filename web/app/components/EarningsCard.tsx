"use client";

import { useEffect, useState } from "react";

// Earnings IV-Crush: ¿la IV precia MÁS de lo que la acción suele moverse en earnings?
// Se auto-obtiene de /api/earnings para no engordar page.tsx.
// Ver docs/superpowers/specs/2026-07-27-earnings-iv-crush-design.md

type Verdict = "rica" | "justa" | "barata" | "sin_datos";

interface Spread {
  kind: "bull_put" | "bear_call";
  shortStrike: number;
  longStrike: number;
  width: number;
  credit: number;
  maxLoss: number;
  breakeven: number;
  riskReward: number;
  probOTM: number;
  shortWallStrength: number | null;
}

interface EarningsData {
  spreads: { putSpread: Spread | null; callSpread: Spread | null } | null;
  impliedMovePct: number | null;
  histAvgMovePct: number | null;
  histMedianPct: number | null;
  histMaxPct: number | null;
  richness: number | null;
  sample: number;
  verdict: Verdict;
  moves: number[];
  spot: number | null;
  method: "straddle" | "iv" | null;
  straddle: { strike: number; expiration: string; dte: number } | null;
}

const VERDICT: Record<Verdict, { label: string; sub: string; color: string }> = {
  rica: { label: "IV RICA", sub: "vender prima tiene ventaja", color: "#12b76a" },
  justa: { label: "IV JUSTA", sub: "sin edge claro", color: "#667085" },
  barata: { label: "IV BARATA", sub: "no conviene vender prima", color: "#f04438" },
  sin_datos: { label: "Sin datos", sub: "histórico insuficiente (<4 earnings)", color: "#98a2b3" },
};

function SpreadRow({ s }: { s: Spread }) {
  const isPut = s.kind === "bull_put";
  return (
    <div
      style={{
        border: "1px solid #eceff3",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: "0.85em",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <b>{isPut ? "🔻 Vender PUT spread" : "🔺 Vender CALL spread"}</b>
        <span className="muted">
          ${s.shortStrike} / ${s.longStrike} · ancho ${s.width}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        <span>
          Crédito <b style={{ color: "#12b76a" }}>${Math.round(s.credit * 100)}</b>
        </span>
        <span>
          Máx pérdida <b style={{ color: "#f04438" }}>${s.maxLoss}</b>
        </span>
        <span>
          Break-even <b>${s.breakeven}</b>
        </span>
        <span>
          R/R <b>1:{s.riskReward.toFixed(2)}</b>
        </span>
        <span>
          ProbOTM <b>{s.probOTM}%</b>
        </span>
      </div>
    </div>
  );
}

export default function EarningsCard({ ticker }: { ticker: string }) {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) return;
    let alive = true;
    setLoading(true);
    setData(null);
    fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d && !d.error) setData(d as EarningsData);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ticker]);

  if (loading) {
    return (
      <section className="scorecard">
        <div className="muted" style={{ padding: "8px 4px" }}>
          Calculando move implícito vs histórico de earnings…
        </div>
      </section>
    );
  }
  if (!data) return null;

  const v = VERDICT[data.verdict];
  const implied = data.impliedMovePct;
  const avg = data.histAvgMovePct;
  const scale = Math.max(implied ?? 0, data.histMaxPct ?? 0, 1);

  const Bar = ({ pct, color }: { pct: number | null; color: string }) => (
    <div style={{ height: 10, background: "#eceff3", borderRadius: 5, overflow: "hidden" }}>
      <div
        style={{
          width: `${Math.min(((pct ?? 0) / scale) * 100, 100)}%`,
          height: "100%",
          background: color,
          borderRadius: 5,
        }}
      />
    </div>
  );

  return (
    <section className="scorecard">
      <div className="score-main">
        <div className="score-cat">Earnings · IV Crush</div>
        <div className="score-q">¿La IV precia más de lo que la acción suele moverse?</div>
      </div>

      <div className="score-detail">
        <div
          className="score-verdict"
          style={{ color: v.color, display: "flex", alignItems: "baseline", gap: 8 }}
        >
          {v.label}
          {data.richness != null && (
            <span style={{ fontWeight: 800 }}>· {data.richness.toFixed(2)}×</span>
          )}
          <span className="muted" style={{ fontWeight: 400, fontSize: "0.85em" }}>
            {v.sub}
          </span>
        </div>

        {/* Barras comparativas implícito vs histórico */}
        <div style={{ display: "grid", gap: 10, margin: "12px 0" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85em" }}>
              <span>
                Move <b>implícito</b>
                {data.straddle && (
                  <span className="muted">
                    {" "}
                    (straddle ${data.straddle.strike} · {data.straddle.expiration})
                  </span>
                )}
              </span>
              <b style={{ color: "#2e6be6" }}>
                {implied != null ? `±${implied.toFixed(1)}%` : "—"}
              </b>
            </div>
            <Bar pct={implied} color="#2e6be6" />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85em" }}>
              <span>
                Move <b>histórico</b> (prom.){" "}
                <span className="muted">— {data.sample} earnings</span>
              </span>
              <b>{avg != null ? `±${avg.toFixed(1)}%` : "—"}</b>
            </div>
            <Bar pct={avg} color="#98a2b3" />
          </div>
        </div>

        {data.sample > 0 && (
          <div className="muted" style={{ fontSize: "0.85em" }}>
            Histórico: mediana ±{data.histMedianPct?.toFixed(1)}% · máx ±{data.histMaxPct?.toFixed(1)}%
            {data.moves.length > 0 && ` · [${data.moves.map((m) => `${m.toFixed(1)}%`).join(" · ")}]`}
          </div>
        )}

        {data.spreads && (data.spreads.putSpread || data.spreads.callSpread) && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: "0.9em", marginBottom: 6 }}>
              Spreads sugeridos <span className="muted">— riesgo definido · |Δ|≈0.20 · fuera de 1σ</span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {data.spreads.putSpread && <SpreadRow s={data.spreads.putSpread} />}
              {data.spreads.callSpread && <SpreadRow s={data.spreads.callSpread} />}
            </div>
          </div>
        )}

        <div
          className="iv-special"
          style={{ marginTop: 12, background: "#fff7ed", padding: 10, borderRadius: 8 }}
        >
          ⚠ <b>Riesgo de gap:</b> el delta/probabilidad <b>subestima</b> el riesgo en earnings
          (colas gordas). Vende con <b>riesgo definido</b> (spreads), no desnudo. Fechas de
          earnings por proxy de filing. Esto es data del agente, no consejo financiero.
        </div>
      </div>
    </section>
  );
}
