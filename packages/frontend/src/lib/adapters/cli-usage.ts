/**
 * cli-usage.ts — GET /api/usage/clis (slice usage-per-cli).
 */

import { type } from "arktype"
import { beUrl } from "$lib/util/be-url"

const cliUsageRowSchema = type({
  cliKind: "string",
  sessions: "number",
  reportsUsage: "boolean",
  lastSeenProjects: "number",
  "lastSeenAtRegistry?": "string",
  turns: "number",
  firstSeenAt: "number",
  lastSeenAt: "number",
  peakUsed: "number",
  sumHeld: "number",
  compactions: "number",
  "costAmount?": "number",
  "costCurrency?": "string",
  "costMixedCurrency?": "true",
})

const responseSchema = type({
  clis: cliUsageRowSchema.array(),
})

export type CliUsageRow = typeof cliUsageRowSchema.infer

export async function fetchCliUsage(opts?: { cwd?: string }): Promise<CliUsageRow[]> {
  const params = new URLSearchParams()
  if (opts?.cwd) params.set("cwd", opts.cwd)
  const qs = params.toString()
  const url = beUrl(`/api/usage/clis${qs ? `?${qs}` : ""}`)
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } })
  if (!res.ok) throw new Error(`fetchCliUsage failed: ${res.status}`)
  const json: unknown = await res.json()
  const parsed = responseSchema(json)
  if (parsed instanceof type.errors) {
    throw new Error(`fetchCliUsage parse error: ${parsed.summary}`)
  }
  return parsed.clis as CliUsageRow[]
}
