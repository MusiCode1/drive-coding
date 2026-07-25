/**
 * machine-stats — נגזרות RAM/CPU של מכונת ה-BE, טהור לחלוטין.
 *
 * הקלט הגולמי (`RawMachineSample`) נשלף ב-backend מ-`node:os` (imperative shell);
 * הפונקציה כאן רק מחשבת נגזרות (MB, אחוזים, clamp) — אין IO, אין `node:os`.
 * type משותף BE↔FE (`MachineStats`), מיוצא דרך `@drive-coding/core`.
 *
 * ─── system ─── (slice-be-machine-stats Commit 0)
 */

/** קלט גולמי כפי שה-shell (backend) שולף מ-node:os. numbers בלבד — pure, ללא IO. */
export interface RawMachineSample {
  totalMemBytes: number
  freeMemBytes: number
  loadAvg1: number // os.loadavg()[0]
  cpuCount: number // os.cpus().length (>=1)
}

/** מדדים נגזרים לתצוגה. type משותף BE↔FE (מיוצא דרך @drive-coding/core). */
export interface MachineStats {
  totalMemMB: number
  usedMemMB: number
  freeMemMB: number
  memPct: number // 0..100, מעוגל למספר שלם
  loadAvg1: number // מעוגל ל-1 ספרה
  cpuCount: number
  loadPct: number // loadAvg1 / cpuCount * 100, clamped 0..100, מעוגל
}

const bToMb = (b: number): number => Math.round(b / 1024 / 1024)
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

export function deriveMachineStats(raw: RawMachineSample): MachineStats {
  const usedMemBytes = raw.totalMemBytes - raw.freeMemBytes
  const memPct = raw.totalMemBytes <= 0 ? 0 : Math.round((usedMemBytes / raw.totalMemBytes) * 100)
  const cpuCount = Math.max(1, raw.cpuCount)
  const loadPct = clamp(Math.round((raw.loadAvg1 / cpuCount) * 100), 0, 100)

  return {
    totalMemMB: bToMb(raw.totalMemBytes),
    usedMemMB: bToMb(usedMemBytes),
    freeMemMB: bToMb(raw.freeMemBytes),
    memPct,
    loadAvg1: Math.round(raw.loadAvg1 * 10) / 10,
    cpuCount,
    loadPct,
  }
}
