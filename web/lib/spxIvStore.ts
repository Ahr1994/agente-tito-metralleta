// IV Rank de SPX por proxy: acumula la IV ATM del día en data/spx-iv/SPX.json y la rankea
// contra su rango reciente. Arranca "sin datos suficientes" hasta juntar ≥5 fotos (Massive no
// da el VIX/VIX1D en este plan). Solo servidor.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { promises as fs } from "fs";
import path from "path";
import { marketDateStr } from "./occ";
import { rankWithin } from "./ivcontext";

const FILE = path.join(process.cwd(), "data", "spx-iv", "SPX.json");
const MAX_POINTS = 400; // ~1 año de sesiones
const MIN_SAMPLES = 5;

export interface SpxIvPoint {
  date: string; // fecha de mercado ET
  atmIv: number; // decimal (0.14 = 14%)
}

export interface SpxIvRank {
  value: number | null; // 0-100
  source: "history" | "insufficient";
  samples: number;
}

export async function loadSpxIv(): Promise<SpxIvPoint[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as { points?: SpxIvPoint[] };
    return Array.isArray(parsed.points) ? parsed.points : [];
  } catch {
    return [];
  }
}

/** Guarda la IV ATM del día (una por fecha de mercado, dedupe) y devuelve el historial. */
export async function saveSpxIv(atmIv: number, now: Date = new Date()): Promise<SpxIvPoint[]> {
  if (!(atmIv > 0)) return loadSpxIv();
  const date = marketDateStr(now);
  const existing = (await loadSpxIv()).filter((p) => p.date !== date);
  const points = [{ date, atmIv }, ...existing].slice(0, MAX_POINTS);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ updatedAt: now.toISOString(), points }, null, 2));
  return points;
}

/** Rankea la IV ATM actual dentro del rango acumulado. Necesita ≥5 fotos para ser fiable. */
export function spxIvRank(history: SpxIvPoint[], current: number | null): SpxIvRank {
  const series = history.map((p) => p.atmIv).filter((v) => v > 0);
  if (current == null || series.length < MIN_SAMPLES) {
    return { value: null, source: "insufficient", samples: series.length };
  }
  return { value: rankWithin(series, current), source: "history", samples: series.length };
}
