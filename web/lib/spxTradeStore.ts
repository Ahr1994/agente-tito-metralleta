// Almacén de los credit spreads de SPX del usuario: data/spx-trades/SPX.json. Sirve de
// bitácora ("cómo me fue vendiendo prima el 0DTE") con la foto del GEX/flujo del momento.
// Solo servidor. Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "spx-trades", "SPX.json");
const MAX = 300;

export interface SpxTrade {
  id: string;
  savedAt: string; // ISO
  dte: 0 | 1;
  kind: "bull_put" | "bear_call";
  shortStrike: number;
  longStrike: number;
  width: number;
  credit: number; // por acción
  expiration: string | null;
  // foto del momento
  spotAtEntry: number | null;
  atmIvAtEntry: number | null; // %
  regimeAtEntry: "positive" | "negative" | null;
  wallAtEntry: number | null; // muro de GEX de referencia
  flowLeanAtEntry: "bullish" | "bearish" | "neutral" | null;
  probOTM: number | null;
  evMargin: number | null;
  note?: string;
}

export async function loadSpxTrades(): Promise<SpxTrade[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as { trades?: SpxTrade[] };
    return Array.isArray(parsed.trades) ? parsed.trades : [];
  } catch {
    return [];
  }
}

/** Agrega un trade (más reciente primero) y persiste. */
export async function saveSpxTrade(trade: SpxTrade): Promise<SpxTrade[]> {
  const trades = [trade, ...(await loadSpxTrades())].slice(0, MAX);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), trades }, null, 2));
  return trades;
}
