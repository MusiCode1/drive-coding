/**
 * live-token.ts — fetch ephemeral Live token from BE.
 *
 * Slice: live-ears, Commit 3.
 */

import { buildLiveActions } from "@drive-coding/core/voice/live-actions"
import { buildLiveSecretaryPrompt } from "@drive-coding/core/voice/live-prompt"

export type LiveTokenResult = {
  token: string
  model: string
  sessionConfig: Record<string, unknown>
  expiresAt: string
}

export async function fetchLiveToken(opts?: {
  language?: "he" | "en"
  voiceName?: string
}): Promise<LiveTokenResult> {
  const language = opts?.language ?? "he"
  const body = {
    systemInstruction: buildLiveSecretaryPrompt({ language }),
    actions: buildLiveActions().map((a) => a.name),
    voiceName: opts?.voiceName,
  }

  const res = await fetch("/api/voice/live/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (res.status === 503) {
    throw new Error("live.token.noApiKey")
  }
  if (!res.ok) {
    throw new Error("live.token.failed")
  }

  const data = (await res.json()) as LiveTokenResult
  return data
}
