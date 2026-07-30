// Guarda una foto diaria de los muros de GEX del 0DTE en data/spx-gex/SPX.json, para luego
// comprobar (backtest) si el precio de verdad respeta los muros. Solo servidor.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { promises as fs } from "fs";
import path from "path";
import { marketDateStr } from "./occ";

const FILE = path.join(process.cwd(), "data", "spx-gex", "SPX.json");
const MAX = 400;

export interface SpxGexSnapshot {
  date: string; // fecha de mercado ET
  spot: number;
  putWall: number | null;
  callWall: number | null;
  magnet: number | null;
  regime: "positive" | "negative";
}

export async function loadSpxGexHistory(): Promise<SpxGexSnapshot[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as { snapshots?: SpxGexSnapshot[] };
    return Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
  } catch {
    return [];
  }
}

/** Guarda la foto de muros del día (una por fecha de mercado, dedupe). */
export async function saveSpxGexSnapshot(
  snap: Omit<SpxGexSnapshot, "date">,
  now: Date = new Date(),
): Promise<SpxGexSnapshot[]> {
  const date = marketDateStr(now);
  const existing = (await loadSpxGexHistory()).filter((s) => s.date !== date);
  const snapshots = [{ date, ...snap }, ...existing].slice(0, MAX);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ updatedAt: now.toISOString(), snapshots }, null, 2));
  return snapshots;
}
