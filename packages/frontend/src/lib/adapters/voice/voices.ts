/**
 * voices.ts — ElevenLabs voice catalog (via BE proxy + OneCLI).
 *
 * GET /v1/voices returns the full library available to the API key.
 * We surface only the fields the picker needs; raw shape is kept loose.
 *
 * The xi-api-key header is a placeholder — OneCLI injects the real key at
 * the proxy. Same pattern as tts.ts (learnings 2026-05-16).
 */

import { beUrl } from "$lib/util/be-url"

export type Voice = {
  voice_id: string
  name: string
  /** ElevenLabs category — "premade", "cloned", "professional", "generated" */
  category?: string
  /** Optional labels (accent, age, gender, descriptive…) */
  labels?: Record<string, string>
}

type VoicesResponse = {
  voices?: Voice[]
}

/**
 * List voices available to the API key.
 * Errors are bubbled — callers (typically a VM) catch + log.
 */
export async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const res = await fetch(beUrl("/proxy/elevenlabs/v1/voices"), {
    method: "GET",
    headers: {
      "xi-api-key": "browser-placeholder", // OneCLI replaces at proxy
      accept: "application/json",
    },
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`listVoices failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as VoicesResponse
  return data.voices ?? []
}
