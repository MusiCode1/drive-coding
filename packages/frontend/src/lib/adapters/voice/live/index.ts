/**
 * index.ts — resolve Live provider from VoiceModelRef.
 *
 * Slice: live-contract-gemini, Commit 2.
 */

import type { VoiceModelRef } from "@drive-coding/core/voice/capabilities"
import type { LiveProvider } from "@drive-coding/core/voice/live-types"
import { geminiLive } from "./gemini.js"

export function resolveLive(ref: VoiceModelRef): LiveProvider {
  if (ref.provider === "google") return geminiLive
  throw new Error(`Unsupported live provider: ${ref.provider}`)
}

export { geminiLive } from "./gemini.js"
