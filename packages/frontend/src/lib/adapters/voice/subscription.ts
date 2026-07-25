/**
 * subscription.ts — adapter for ElevenLabs /v1/user/subscription.
 *
 * Slice: tts-status-ui, Commit 0.
 *
 * Follows the pattern from voices.ts: fetch via BE proxy with placeholder key
 * (OneCLI injects the real key on the BE side).
 *
 * ArkType parses only the fields we need; tier is optional (missing on some plans).
 * Extra fields are ignored via "+": "ignore" (no parse-throw on unknown fields).
 *
 * On parse-fail or network-fail: throws — caller (VM) catches + sets undefined.
 */

import { type } from "arktype"
import { beUrl } from "$lib/util/be-url"

export type ElevenLabsSubscription = {
  characterCount: number
  characterLimit: number
  status: string
  tier?: string
  /** max_character_limit_extension — used with canExtend for effective-limit (tts-quota-refine) */
  maxExtension?: number
  /** can_extend_character_limit — true when ElevenLabs allows overage up to maxExtension (tts-quota-refine) */
  canExtend?: boolean
}

// ArkType schema — snake_case from the API, only needed fields, tier optional
const subscriptionSchema = type({
  character_count: "number",
  character_limit: "number",
  status: "string",
  "tier?": "string",
  "max_character_limit_extension?": "number",
  "can_extend_character_limit?": "boolean",
  "+": "ignore",
})

/**
 * Reads /proxy/elevenlabs/v1/user/subscription (BE injects real key via OneCLI).
 * The "browser-placeholder" header matches the pattern in voices.ts and tts.ts.
 * Throws on network error or parse failure — let the caller handle gracefully.
 */
export async function fetchElevenLabsSubscription(
  signal?: AbortSignal,
): Promise<ElevenLabsSubscription> {
  const res = await fetch(beUrl("/proxy/elevenlabs/v1/user/subscription"), {
    method: "GET",
    headers: {
      "xi-api-key": "browser-placeholder", // OneCLI injects real key in proxy
      accept: "application/json",
    },
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`fetchElevenLabsSubscription failed: ${res.status} ${body}`)
  }

  const json: unknown = await res.json()
  const parsed = subscriptionSchema(json)
  if (parsed instanceof type.errors) {
    throw new Error(`fetchElevenLabsSubscription parse error: ${parsed.summary}`)
  }

  return {
    characterCount: parsed.character_count,
    characterLimit: parsed.character_limit,
    status: parsed.status,
    tier: parsed.tier,
    maxExtension: parsed.max_character_limit_extension,
    canExtend: parsed.can_extend_character_limit,
  }
}
