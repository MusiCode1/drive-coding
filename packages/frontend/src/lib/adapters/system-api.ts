/**
 * system-api.ts — לקוח REST מינימלי עבור מדדי-מכונה (GET /api/diag → שדה machine).
 *
 * מחקה את agents-api.ts: withTimeout + beUrl. ללא ניסיונות חוזרים, ללא וולידציית
 * סכמה — נתיב מהיר (עקבי עם agents-api). ─── system ─── (slice-be-machine-stats Commit 2)
 */

import type { MachineStats } from "@drive-coding/core"
import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { beUrl } from "$lib/util/be-url"

const SYSTEM_API_TIMEOUT_MS = 10000

/** מושך מדדי-מכונה מה-BE (GET /api/diag → שדה machine). */
export async function getMachineStats(signal?: AbortSignal): Promise<MachineStats> {
  const res = await withTimeout(
    (s) => fetch(beUrl("/api/diag"), { signal: s }),
    SYSTEM_API_TIMEOUT_MS,
    { signal, label: "getMachineStats" },
  )
  if (!res.ok) {
    throw new Error(`getMachineStats failed: ${res.status}`)
  }
  const body = (await res.json()) as { machine?: MachineStats }
  if (!body.machine) {
    throw new Error("getMachineStats failed: missing machine field in /api/diag response")
  }
  return body.machine
}
