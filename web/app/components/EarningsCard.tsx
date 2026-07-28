"use client";

import { useEffect, useState } from "react";

// Earnings IV-Crush: ¿la IV precia MÁS de lo que la acción suele moverse en earnings?
// Se auto-obtiene de /api/earnings para no engordar page.tsx.
// Ver docs/superpowers/specs/2026-07-27-earnings-iv-crush-design.md

type Verdict = "rica" | "justa" | "barata" | "sin_datos";

interface EarningsData {
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
