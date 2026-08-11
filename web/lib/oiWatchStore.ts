// Guarda los candidatos de "apertura" detectados por ticker y sesión, para confirmarlos contra el
// OI del día siguiente. Solo servidor. Ver lib/oiConfirm.ts.

import { promises as fs } from "fs";
import path from "path";
import type { OpeningCandidate } from "./oiConfirm";

const DIR = path.join(process.cwd(), "data", "oi-watch");
const MAX_SESSIONS = 60;

export interface OiWatchSession {
  date: string; // sesión de mercado ET
  detectedAt: string; // ISO
  candidates: OpeningCandidate[];
}

function fileFor(ticker: string): string {
  return path.join(DIR, `${ticker.toUpperCase()}.json`);
}

export async function loadOiWatch(ticker: string): Promise<OiWatchSession[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(fileFor(ticker), "utf8")) as { sessions?: OiWatchSession[] };
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

/** Guarda (o reemplaza) los candidatos de una sesión. Dedupe por fecha. */
export async function saveOiWatch(ticker: string, session: OiWatchSession): Promise<OiWatchSession[]> {
  const existing = (await loadOiWatch(ticker)).filter((s) => s.date !== session.date);
  const sessions = [session, ...existing].slice(0, MAX_SESSIONS);
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(fileFor(ticker), JSON.stringify({ updatedAt: new Date().toISOString(), ticker: ticker.toUpperCase(), sessions }, null, 2));
  return sessions;
}

/** La sesión guardada más reciente ANTERIOR a `date` (para confirmar contra el OI de hoy). */
export function priorOiSession(sessions: OiWatchSession[], date: string): OiWatchSession | null {
  return sessions.filter((s) => s.date < date).sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
}
