/**
 * usage.ts — adapter for GET /api/usage/summary.
 *
 * Slice: tts-status-ui, Commit 0.
 *
 * Fetches accumulated TTS usage totals per provider from the backend.
 * No auth header needed — local BE endpoint.
 *
 * On network error or non-ok response: throws — caller (VM) catches + sets undefined.
 */

import { type } from "arktype"
import { beUrl } from "$lib/util/be-url"

export type ProviderTotals = {
  requests: number
  cacheHits: number
  chars: number
  inputTokens: number
  audioTokens: number
  costUsd: number
}

export type UsageSummary = Record<"elevenlabs" | "google", ProviderTotals>

// ArkType schema for a single provider's totals
const providerTotalsSchema = type({
  requests: "number",
  cacheHits: "number",
  chars: "number",
  inputTokens: "number",
  audioTokens: "number",
  costUsd: "number",
  "+": "ignore",
})

// Schema for the full summary
const usageSummarySchema = type({
  elevenlabs: providerTotalsSchema,
  google: providerTotalsSchema,
  "+": "ignore",
})

/**
 * Fetches TTS usage summary from GET /api/usage/summary.
 * Throws on network error or parse failure — let the caller handle gracefully.
 */
export async function fetchUsageSummary(): Promise<UsageSummary> {
  const res = await fetch(beUrl("/api/usage/summary"), {
    method: "GET",
    headers: { accept: "application/json" },
  })

  if (!res.ok) {
    throw new Error(`fetchUsageSummary failed: ${res.status}`)
  }

  const json: unknown = await res.json()
  const parsed = usageSummarySchema(json)
  if (parsed instanceof type.errors) {
    throw new Error(`fetchUsageSummary parse error: ${parsed.summary}`)
  }

  return parsed as UsageSummary
}
