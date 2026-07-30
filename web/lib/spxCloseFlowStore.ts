// Guarda las ventas de prima detectadas en el cierre, por sesión, en data/spx-close-flow/
// SPX.json, para confirmarlas contra el OI al día siguiente. Solo servidor.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import { promises as fs } from "fs";
import path from "path";
import type { ClosingSell } from "./closingFlow";

const FILE = path.join(process.cwd(), "data", "spx-close-flow", "SPX.json");
const MAX_DAYS = 120;

export interface CloseFlowDay {
  date: string; // sesión de mercado ET en que se detectó
  detectedAt: string; // ISO
  sells: ClosingSell[];
}

export async function loadCloseFlow(): Promise<CloseFlowDay[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8")) as { days?: CloseFlowDay[] };
    return Array.isArray(parsed.days) ? parsed.days : [];
  } catch {
    return [];
  }
}

/** Guarda (o reemplaza) las ventas del cierre de una sesión. Dedupe por fecha. */
export async function saveCloseFlow(day: CloseFlowDay): Promise<CloseFlowDay[]> {
  const existing = (await loadCloseFlow()).filter((d) => d.date !== day.date);
  const days = [day, ...existing].slice(0, MAX_DAYS);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), days }, null, 2));
  return days;
}

/** La sesión guardada más reciente ANTERIOR a `date` (para confirmar contra el OI de hoy). */
export function priorSession(days: CloseFlowDay[], date: string): CloseFlowDay | null {
  return days.filter((d) => d.date < date).sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
}
