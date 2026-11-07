/**
 * legacy-record-schema.test.ts — the three policy rules, one case each.
 *
 * Mutation control: delete the `validateLegacyUsageRecord` call in loadUsageRecords
 * and the fidelity suite's "no malformed record leaked" case fails; weaken the
 * optional-field handling and "keeps the record" below fails.
 */

import { describe, expect, it } from "vitest"
import { validateLegacyProjectEntry, validateLegacyUsageRecord } from "./legacy-record-schema.js"

const GOOD = {
  acpSessionId: "s1",
  agentId: "a1",
  cliKind: "claude",
  cwd: "/p",
  firstSeenAt: 1,
  lastSeenAt: 2,
  turns: 0,
  lastUsed: 1,
  size: 1,
  cycles: [{ startedAt: 1, peakUsed: 1, closedAt: null }],
  cyclesTruncated: false,
}

describe("validateLegacyUsageRecord", () => {
  it("accepts a well-formed record unchanged", () => {
    const r = validateLegacyUsageRecord(GOOD)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual(GOOD)
      expect(r.droppedFields).toEqual([])
    }
  })

  it("required field bad ⇒ record skipped, reason names the field and the id", () => {
    const { cliKind: _omit, ...noCliKind } = GOOD
    const r = validateLegacyUsageRecord(noCliKind)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain("s1")
      expect(r.reason).toContain("cliKind")
    }
  })

  it("optional field bad ⇒ field dropped, record KEPT", () => {
    const r = validateLegacyUsageRecord({ ...GOOD, costAmount: "free", costCurrency: "USD" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.droppedFields).toEqual(["costAmount"])
      expect("costAmount" in r.value).toBe(false)
      expect(r.value.costCurrency).toBe("USD")
    }
  })

  it("unknown key survives — older writers added fields we must not throw away", () => {
    const r = validateLegacyUsageRecord({ ...GOOD, fieldFromOlderWriter: "keep me" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const kept = r.value as unknown as { fieldFromOlderWriter?: string }
      expect(kept.fieldFromOlderWriter).toBe("keep me")
    }
  })

  it("a non-string acpSessionId is reported, not dropped in silence", () => {
    const r = validateLegacyUsageRecord({ ...GOOD, acpSessionId: 42 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("acpSessionId")
  })

  it("a malformed member inside cycles rejects the record", () => {
    const r = validateLegacyUsageRecord({
      ...GOOD,
      cycles: [{ startedAt: "x", peakUsed: 1, closedAt: null }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("cycles")
  })
})

describe("validateLegacyProjectEntry", () => {
  it("accepts an entry with no lastSessionId — that is the legacy-folder shape", () => {
    const r = validateLegacyProjectEntry({ cwd: "/p", kind: "claude", lastSeen: "2026-01-01" })
    expect(r.ok).toBe(true)
  })

  it("missing kind ⇒ skipped, reason names the cwd", () => {
    const r = validateLegacyProjectEntry({ cwd: "/p", lastSeen: "2026-01-01" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain("/p")
      expect(r.reason).toContain("kind")
    }
  })

  it("an unparseable lastSeen still validates — it is counted at import, not rejected", () => {
    const r = validateLegacyProjectEntry({ cwd: "/p", kind: "claude", lastSeen: "whenever" })
    expect(r.ok).toBe(true)
  })
})
