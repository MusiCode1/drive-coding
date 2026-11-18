/**
 * token-usage.ts — GET /api/usage/tokens (slice token-usage-persistence C4).
 */

import {
  compactionsFromCycles as compactionsFromCyclesCore,
  sumOfCyclePeaks as sumOfCyclePeaksCore,
} from "@drive-coding/core/usage/cli-usage"
import { type } from "arktype"
import { beUrl } from "$lib/util/be-url"

const usageCycleSchema = type({
  startedAt: "number",
  peakUsed: "number",
  closedAt: "number | null",
})

const tokenUsageRecordSchema = type({
  acpSessionId: "string",
  agentId: "string",
  cliKind: "string",
  cwd: "string",
  firstSeenAt: "number",
  lastSeenAt: "number",
  turns: "number",
  lastUsed: "number",
  size: "number",
  cycles: usageCycleSchema.array(),
  cyclesTruncated: "boolean",
  "costAmount?": "number",
  "costCurrency?": "string",
})

const responseSchema = type({
  sessions: tokenUsageRecordSchema.array(),
})

export type TokenUsageCycle = typeof usageCycleSchema.infer
export type TokenUsageRecord = typeof tokenUsageRecordSchema.infer

export const compactionsFromCycles = compactionsFromCyclesCore
export const sumOfCyclePeaks = sumOfCyclePeaksCore

export async function fetchTokenUsage(opts?: {
  cwd?: string
  limit?: number
}): Promise<TokenUsageRecord[]> {
  const params = new URLSearchParams()
  if (opts?.cwd) params.set("cwd", opts.cwd)
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit))
  const qs = params.toString()
  const url = beUrl(`/api/usage/tokens${qs ? `?${qs}` : ""}`)
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } })
  if (!res.ok) throw new Error(`fetchTokenUsage failed: ${res.status}`)
  const json: unknown = await res.json()
  const parsed = responseSchema(json)
  if (parsed instanceof type.errors) {
    throw new Error(`fetchTokenUsage parse error: ${parsed.summary}`)
  }
  return parsed.sessions as TokenUsageRecord[]
}
