// Captura CONTINUA del tape institucional de SPX durante la sesión. El feed en vivo de MarketSnack
// es una ventana rodante (solo sirve los últimos minutos, no se puede paginar hacia atrás por su
// densidad), así que un print grande de hace 10 min se pierde. Este store ACUMULA: cada poll
// mergea la ventana reciente y deduplica, de modo que al final del día tenemos el tape completo y
// nunca volvemos a estar ciegos a un print como el 7800P de las 12:59. Solo servidor.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { promises as fs } from "fs";
import path from "path";
import type { SpxFlowTrade } from "./spx";

const DIR = path.join(process.cwd(), "data", "spx-tape");
const MAX_PRINTS = 6000; // tope por sesión (nos quedamos con los mayores por premium si se excede)
const DEFAULT_FLOOR = 50_000; // solo capturamos prints ≥ esto (institucionales)

function fileFor(date: string): string {
  return path.join(DIR, `${date}.json`);
}

/** Firma única de un print para deduplicar entre polls que se solapan en el tiempo. */
export function printKey(t: SpxFlowTrade): string {
  return `${t.timestamp}|${t.strike}|${t.type}|${t.size}|${Math.round(t.premium)}|${t.rawSide}`;
}

export async function loadTapeSession(date: string): Promise<SpxFlowTrade[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(fileFor(date), "utf8")) as { prints?: SpxFlowTrade[] };
    return Array.isArray(parsed.prints) ? parsed.prints : [];
  } catch {
    return [];
  }
}

export interface MergeResult {
  prints: SpxFlowTrade[]; // acumulado de la sesión (dedupe)
  added: number; // cuántos prints nuevos entraron en este merge
  total: number;
}

/**
 * Mergea la ventana reciente en el acumulado de la sesión: filtra al piso, deduplica por firma,
 * ordena por hora desc y persiste. Devuelve el acumulado completo del día.
 */
export async function mergeTapeSession(
  date: string,
  incoming: SpxFlowTrade[],
  floor: number = DEFAULT_FLOOR,
): Promise<MergeResult> {
  const existing = await loadTapeSession(date);
  const byKey = new Map<string, SpxFlowTrade>();
  for (const t of existing) byKey.set(printKey(t), t);
  let added = 0;
  for (const t of incoming) {
    if (t.premium < floor) continue;
    const k = printKey(t);
    if (!byKey.has(k)) {
      byKey.set(k, t);
      added += 1;
    }
  }
  let prints = [...byKey.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  if (prints.length > MAX_PRINTS) {
    // conservamos los mayores por premium (los que importan), pero re-ordenados por hora
    prints = [...prints].sort((a, b) => b.premium - a.premium).slice(0, MAX_PRINTS);
    prints.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(
    fileFor(date),
    JSON.stringify({ updatedAt: new Date().toISOString(), date, prints }, null, 2),
  );
  return { prints, added, total: prints.length };
}
