/**
 * tts-capabilities.ts — adapter for GET /api/tts/capabilities.
 *
 * Slice: tts-provider-availability, Commit 2.
 *
 * Follows the pattern from options.ts: fetch + throw on non-ok.
 */

import type { ProbeResult } from "@drive-coding/core/tts/probe-status"
import { beUrl } from "$lib/util/be-url"

export type ProviderCapabilities = Record<"elevenlabs" | "google", ProbeResult>

/**
 * Fetches TTS provider availability from the backend.
 * Throws if the request fails.
 */
export async function fetchTtsCapabilities(): Promise<ProviderCapabilities> {
  const res = await fetch(beUrl("/api/tts/capabilities"))
  if (!res.ok) throw new Error(`/api/tts/capabilities ${res.status}`)
  return res.json() as Promise<ProviderCapabilities>
}
