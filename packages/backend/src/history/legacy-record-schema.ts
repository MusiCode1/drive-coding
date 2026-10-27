/**
 * legacy-record-schema.ts — runtime validation for the legacy JSON the boot import reads.
 *
 * Why this exists: `loadUsageRecords` used to filter on `typeof acpSessionId === "string"`
 * and then cast. Measured consequence — a record missing `cliKind` reached
 * `INSERT INTO sessions` and raised `NOT NULL constraint failed: sessions.cliKind`,
 * which propagates out of `prepareBoot()` (awaited without a catch in run-server.ts).
 * The backend then **never started**, and because the migration marker is written in the
 * same transaction that failed, every later boot repeated it. One bad record was a
 * permanent, self-repeating boot failure.
 *
 * Policy (user decision 2026-10-10):
 *   required field bad   → skip the whole record, count it, name it in the log
 *   optional field bad   → drop that field only, keep the record (more data survives)
 *   unknown key          → passes through untouched (old writers added fields; rejecting
 *                          them would be the data loss we are trying to prevent)
 */

import { type } from "arktype"
import type { TokenUsageRecord } from "../usage/token-usage-store.js"

const UsageCycle = type({
  startedAt: "number",
  peakUsed: "number",
  closedAt: "number | null",
})

/** Required fields only — the optional cost pair is validated separately. */
const UsageRecordRequired = type({
  acpSessionId: "string >= 1",
  agentId: "string",
  cliKind: "string >= 1",
  cwd: "string",
  firstSeenAt: "number",
  lastSeenAt: "number",
  turns: "number",
  lastUsed: "number",
  size: "number",
  cycles: UsageCycle.array(),
  cyclesTruncated: "boolean",
})

const ProjectEntryRequired = type({
  cwd: "string >= 1",
  kind: "string >= 1",
  lastSeen: "string",
  "lastSessionId?": "string",
})

export type LegacyProjectEntry = typeof ProjectEntryRequired.infer

export type ValidationResult<T> =
  | { ok: true; value: T; droppedFields: string[] }
  | { ok: false; reason: string }

/** Identifier for the log — best effort, the record may be any shape at all. */
function recordLabel(v: unknown): string {
  if (v && typeof v === "object") {
    const id = (v as { acpSessionId?: unknown }).acpSessionId
    if (typeof id === "string" && id.length > 0) return id
  }
  return "<unidentifiable>"
}

/**
 * Deletes optional fields whose type is wrong and names them. The record itself
 * survives — losing one field beats losing a whole session's history.
 */
function dropBadOptionals(
  target: Record<string, unknown>,
  expected: Record<string, "number" | "string">,
): string[] {
  const dropped: string[] = []
  for (const [field, want] of Object.entries(expected)) {
    if (field in target && typeof target[field] !== want) {
      delete target[field]
      dropped.push(field)
    }
  }
  return dropped
}

export function validateLegacyUsageRecord(v: unknown): ValidationResult<TokenUsageRecord> {
  const checked = UsageRecordRequired(v)
  if (checked instanceof type.errors) {
    return { ok: false, reason: `${recordLabel(v)}: ${checked.summary}` }
  }
  // Unknown keys survive ArkType, so `checked` still carries them.
  const out = { ...(checked as object) } as Record<string, unknown>
  const dropped = dropBadOptionals(out, { costAmount: "number", costCurrency: "string" })
  return { ok: true, value: out as unknown as TokenUsageRecord, droppedFields: dropped }
}

export function validateLegacyProjectEntry(v: unknown): ValidationResult<LegacyProjectEntry> {
  const checked = ProjectEntryRequired(v)
  if (checked instanceof type.errors) {
    const cwd =
      v && typeof v === "object" && typeof (v as { cwd?: unknown }).cwd === "string"
        ? (v as { cwd: string }).cwd
        : "<unidentifiable>"
    return { ok: false, reason: `${cwd}: ${checked.summary}` }
  }
  const out = { ...(checked as object) } as Record<string, unknown>
  const dropped = dropBadOptionals(out, { lastSessionId: "string" })
  return { ok: true, value: out as unknown as LegacyProjectEntry, droppedFields: dropped }
}

/** Counters surfaced to the boot log — silent loss is the failure mode we are closing. */
export type LegacyImportStats = {
  usageSkipped: number
  projectsSkipped: number
  fieldsDropped: number
  /** `lastSeen` that Date.parse could not read — the row still imports, with "now". */
  unparsedLastSeen: number
  /** reason → count, so a repeated shape shows up as one line with a number. */
  reasons: Record<string, number>
}

export function emptyLegacyImportStats(): LegacyImportStats {
  return {
    usageSkipped: 0,
    projectsSkipped: 0,
    fieldsDropped: 0,
    unparsedLastSeen: 0,
    reasons: {},
  }
}

export function noteReason(stats: LegacyImportStats | undefined, reason: string): void {
  if (!stats) return
  stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1
}
