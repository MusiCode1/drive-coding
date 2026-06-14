/**
 * recordings.ts — שמירה + כתובת URL של הקלטות משתמש ב-BE.
 *
 * POST /api/recordings — שולח אודיו (base64) ומחזיר { id }.
 * recordingUrl(id) — URL להשמעה מאוחרת.
 *
 * ─── msr-v2 (Commit 4) ───
 */

import { bytesToBase64 } from "./base64"

/** שומר blob אודיו ב-BE. מחזיר { id } — recordingId לשימוש עתידי. */
export async function saveRecording(blob: Blob): Promise<{ id: string }> {
  const audioBytes = new Uint8Array(await blob.arrayBuffer())
  const base64 = bytesToBase64(audioBytes)
  const mimeType = blob.type || "audio/webm"

  const res = await fetch("/api/recordings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: base64, mimeType }),
  })

  if (!res.ok) {
    throw new Error(`saveRecording: ${res.status} ${res.statusText}`)
  }

  const json = (await res.json()) as { id: string }
  return { id: json.id }
}

/** מחזיר URL להשמעת הקלטה לפי מזהה. */
export function recordingUrl(id: string): string {
  return `/api/recordings/${encodeURIComponent(id)}`
}
