"use client";

import { useCallback, useEffect, useState } from "react";
import NavTabs from "@/app/components/NavTabs";
import type { SpxAnalysis, SpxDteSetup } from "@/lib/spxServer";
import type { SpxExtreme } from "@/lib/spx";
import type { SpxTrade } from "@/lib/spxTradeStore";

function evBadge(margin: number): { label: string; color: string } {
  if (margin >= 3) return { label: `EV +${margin} ✅`, color: "#12b76a" };
  if (margin >= -2) return { label: `EV ${margin >= 0 ? "+" : ""}${margin} ➖`, color: "#d9a406" };
  return { label: `EV ${margin} ⚠️`, color: "#f04438" };
}

function ExtremeCard({
  ex,
  dte,
  setup,
  onSave,
}: {
  ex: SpxExtreme;
  dte: 0 | 1;
  setup: SpxDteSetup["setup"];
  onSave: (t: Partial<SpxTrade>) => void;
}) {
  const s = ex.spread;
  const ev = evBadge(ex.evMargin);
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

function DteView({ d, onSave }: { d: SpxDteSetup; onSave: (t: Partial<SpxTrade>) => void }) {
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
            <ExtremeCard key={ex.side} ex={ex} dte={d.dte} setup={setup} onSave={onSave} />
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
  const [trades, setTrades] = useState<SpxTrade[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [mode, setMode] = useState<"delta" | "prima">("prima");
  const [cMin, setCMin] = useState(70);
  const [cMax, setCMax] = useState(100);

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

  const loadTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/spx-trades", { cache: "no-store" });
      const json = await res.json();
      setTrades(json.trades ?? []);
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    load();
    loadTrades();
  }, [load, loadTrades]);

  const save = useCallback(
    async (t: Partial<SpxTrade>) => {
      try {
        const res = await fetch("/api/spx-trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
        const json = await res.json();
        if (res.ok) {
          setTrades(json.trades ?? []);
          setFlash(`Guardado: ${t.kind} ${t.shortStrike}/${t.longStrike}`);
          setTimeout(() => setFlash(null), 2500);
        }
      } catch {
        /* ignora */
      }
    },
    [],
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
                <span className="muted" style={{ fontSize: "0.8em" }}>Spot SPX (derivado)</span>{" "}
                <b style={{ fontSize: "1.2em" }}>${data.spot?.toFixed(0) ?? "—"}</b>
              </div>
              <div>
                <span className="muted" style={{ fontSize: "0.8em" }}>IV ATM</span>{" "}
                <b>{data.atmIv != null ? `${(data.atmIv * 100).toFixed(1)}%` : "—"}</b>
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
          <DteView d={active} onSave={save} />
        ) : (
          data && !busy && (
            <div className="muted">No hay cadena para {dte}DTE ahora mismo (mercado cerrado o sin vencimiento).</div>
          )
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

        {trades.length > 0 && (
          <section className="scorecard" style={{ marginTop: 14 }}>
            <b>📌 Tus spreads SPX guardados</b>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>DTE</th>
                    <th>Spread</th>
                    <th className="num">Crédito</th>
                    <th className="num">ProbOTM</th>
                    <th className="num">EV</th>
                    <th className="num">Spot</th>
                    <th>Flujo</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{new Date(t.savedAt).toLocaleDateString()}</td>
                      <td>{t.dte}DTE</td>
                      <td>
                        <b>{t.kind === "bull_put" ? "PUT" : "CALL"}</b> {t.shortStrike}/{t.longStrike}
                      </td>
                      <td className="num">${(t.credit * 100).toFixed(0)}</td>
                      <td className="num">{t.probOTM ?? "—"}%</td>
                      <td className="num">{t.evMargin != null ? (t.evMargin > 0 ? `+${t.evMargin}` : t.evMargin) : "—"}</td>
                      <td className="num muted">{t.spotAtEntry?.toFixed(0) ?? "—"}</td>
                      <td className="muted">{t.flowLeanAtEntry ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="muted" style={{ fontSize: "0.8em", marginTop: 12 }}>
          Spot derivado por paridad put-call (el índice requiere plan Indices). Riesgo definido,
          pero el 0DTE tiene gap/tail risk real. No es consejo financiero.
        </div>
      </div>
    </main>
  );
}
