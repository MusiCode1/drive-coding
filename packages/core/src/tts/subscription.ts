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

  // Count-based check: only when limit is meaningful (>0) and count is non-negative
  if (sub.characterLimit > 0 && sub.characterCount >= 0 && sub.characterCount >= sub.characterLimit) {
    return { exhausted: true, reason: "quota" }
  }

  // Default: optimistic — don't block on unknown/corrupt data
  return { exhausted: false, reason: "ok" }
}
