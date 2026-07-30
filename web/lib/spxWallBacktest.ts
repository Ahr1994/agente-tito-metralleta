// Comprueba la tesis central del módulo: ¿el precio respeta los muros de GEX? Cruza la foto
// diaria de muros con el rango real de ese día (SPY×10). PURO y testeable.
// Ver docs/superpowers/specs/2026-07-30-spx-0dte-design.md

import type { SpxGexSnapshot } from "./spxGexStore";

export interface DayRange {
  date: string;
  high: number;
  low: number;
  close: number;
}

export interface WallDayResult {
  date: string;
  callWall: number | null;
  putWall: number | null;
  magnet: number | null;
  high: number;
  low: number;
  close: number;
  callHeld: boolean | null; // el máximo NO superó el muro de calls
  putHeld: boolean | null; // el mínimo NO rompió el muro de puts
  magnetErrPct: number | null; // |cierre − imán| / cierre × 100
}

export interface WallBacktest {
  days: WallDayResult[]; // más reciente primero
  sample: number; // días con muros + rango
  callHeldRate: number | null; // % de días que el muro de calls contuvo el máximo
  putHeldRate: number | null; // % que el muro de puts contuvo el mínimo
  bothHeldRate: number | null; // % que ambos muros aguantaron
  avgMagnetErrPct: number | null; // qué tan cerca cerró del imán, en promedio
}

/**
 * Para cada día con muros guardados y rango conocido: ¿el máximo se quedó bajo el muro de
 * calls y el mínimo sobre el de puts? Agrega las tasas. Nota: los muros se guardan una vez al
 * día (cuando corre el análisis), así que es una aproximación del comportamiento intradía.
 */
export function backtestWalls(snapshots: SpxGexSnapshot[], ranges: DayRange[]): WallBacktest {
  const rangeByDate = new Map(ranges.map((r) => [r.date, r]));
  const days: WallDayResult[] = [];
  for (const s of snapshots) {
    const r = rangeByDate.get(s.date);
    if (!r) continue;
    days.push({
      date: s.date,
      callWall: s.callWall,
      putWall: s.putWall,
      magnet: s.magnet,
      high: r.high,
      low: r.low,
      close: r.close,
      callHeld: s.callWall != null ? r.high < s.callWall : null,
      putHeld: s.putWall != null ? r.low > s.putWall : null,
      magnetErrPct: s.magnet != null && r.close > 0 ? (Math.abs(r.close - s.magnet) / r.close) * 100 : null,
    });
  }
  days.sort((a, b) => (a.date < b.date ? 1 : -1)); // más reciente primero

  const rate = (picks: (boolean | null)[]): number | null => {
    const known = picks.filter((p): p is boolean => p != null);
    return known.length ? Math.round((known.filter(Boolean).length / known.length) * 100) : null;
  };
  const magnetErrs = days.map((d) => d.magnetErrPct).filter((e): e is number => e != null);

  return {
    days,
    sample: days.length,
    callHeldRate: rate(days.map((d) => d.callHeld)),
    putHeldRate: rate(days.map((d) => d.putHeld)),
    bothHeldRate: rate(
      days.map((d) => (d.callHeld == null || d.putHeld == null ? null : d.callHeld && d.putHeld)),
    ),
    avgMagnetErrPct: magnetErrs.length
      ? Math.round((magnetErrs.reduce((a, b) => a + b, 0) / magnetErrs.length) * 100) / 100
      : null,
  };
}
