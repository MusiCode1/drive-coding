/**
 * recordings.ts — שמירת הקלטות משתמש ל-BE + URL לניגון.
 *
 * ⚠️ BE (backend/src/delivery/http-history.ts:66-98) דורש JSON
 * { audioBase64, mimeType } ומחזיר { id } (201) — לא body גולמי.
 */

import { beUrl } from "$lib/util/be-url"
import { bytesToBase64 } from "./base64" // קיים (בשימוש transcribe.ts)

/**
 * שומר blob הקלטה ל-BE.
 * @throws כשהשרת מחזיר שגיאה (לטובת retry/backoff בשכבה הקוראת)
 */
export async function saveRecording(
  blob: Blob,
  opts?: { signal?: AbortSignal },
): Promise<{ id: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const res = await fetch(beUrl("/api/recordings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: bytesToBase64(bytes),
      mimeType: blob.type || "audio/webm",
    }),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
  if (!res.ok) throw new Error(`saveRecording failed: ${res.status}`)
  return (await res.json()) as { id: string }
}

/** URL לניגון הקלטה לפי id. */
export function recordingUrl(id: string): string {
  return beUrl(`/api/recordings/${id}`)
}
