/**
 * subscription.ts — pure logic for interpreting TTS provider subscription quota.
 *
 * Slice: tts-quota-subscription, Commit 0.
 *
 * Maps subscription info (character counts + status) to whether the provider
 * is quota-exhausted. Pure function — no IO, no side effects. TDD.
 */

import type { ProbeReason } from "./probe-status.js"

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "free"
  | "free_disabled"
  | "past_due"
  | (string & {})

export type SubscriptionInfo = {
  characterCount: number
  characterLimit: number
  status: SubscriptionStatus
  /** max_character_limit_extension from ElevenLabs subscription (tts-quota-refine) */
  maxExtension?: number
  /** can_extend_character_limit from ElevenLabs subscription (tts-quota-refine) */
  canExtend?: boolean
}

export type QuotaVerdict = { exhausted: boolean; reason: ProbeReason }

/**
 * Pure: maps subscription info to whether the provider is quota-exhausted.
 *
 * free_disabled status → exhausted (account disabled due to free tier)
 * characterLimit > 0 && characterCount >= characterLimit → exhausted
 * otherwise (including characterLimit=0 = unlimited/enterprise, negative counts,
 *   unknown statuses) → not exhausted (optimistic — don't block on corrupt data)
 */
export function interpretSubscription(sub: SubscriptionInfo): QuotaVerdict {
  // Explicit disabled status → always exhausted
  if (sub.status === "free_disabled") {
    return { exhausted: true, reason: "quota" }
  }

  // Effective limit: base + extension (when canExtend=true and maxExtension>0)
  // falls back to base when extension fields are absent or canExtend=false or maxExtension=0
  const effectiveLimit =
    sub.canExtend === true && sub.maxExtension !== undefined && sub.maxExtension > 0
      ? sub.characterLimit + sub.maxExtension
      : sub.characterLimit

  // Count-based check: only when limit is meaningful (>0) and count is non-negative
  if (effectiveLimit > 0 && sub.characterCount >= 0 && sub.characterCount >= effectiveLimit) {
    return { exhausted: true, reason: "quota" }
  }

  // Default: optimistic — don't block on unknown/corrupt data
  return { exhausted: false, reason: "ok" }
}
