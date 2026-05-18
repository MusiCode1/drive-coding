/**
 * recordings-client.ts — upload audio recording to BE storage.
 *
 * POST /api/recordings with audioBase64 + mimeType → { id }
 * Called in background, parallel to STT.
 */

import { bytesToBase64 } from "./base64"

export async function saveRecording(bytes: Uint8Array, mimeType: string): Promise<{ id: string }> {
  const audioBase64 = bytesToBase64(bytes)
  const response = await fetch("/api/recordings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audioBase64, mimeType }),
  })
  if (!response.ok) {
    throw new Error(`Save recording failed: ${response.status}`)
  }
  return response.json() as Promise<{ id: string }>
}
