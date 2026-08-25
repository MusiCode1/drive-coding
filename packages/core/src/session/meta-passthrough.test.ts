/**
 * meta-passthrough.test.ts — enforcement gates G-META, G-KEYS, G-NOFLOOD.
 *
 * slice meta-passthrough Commit 1 (red gate) + Commit 2 (green + no-flood).
 * fixture: packages/core/tests/fixtures/subagent-task-single.json
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { applyPatch } from "./apply-patch"
import { reduce } from "./reduce"
import { patchToSessionUpdates } from "./to-session-update"
import type { Patch, SessionState } from "./types"
import { createInitialSessionState } from "./types"
import type { WireSessionUpdate } from "./to-session-update"

// ─── fixture loading ───

type FixtureEntry = {
  dir: string
  channel: string
  frame: { method?: string; params?: unknown }
}

function loadRecording(): Record<string, unknown>[] {
  const fixturePath = join(import.meta.dirname, "../../tests/fixtures/subagent-task-single.json")
  const fixture: FixtureEntry[] = JSON.parse(readFileSync(fixturePath, "utf-8"))
  return fixture
    .filter((e) => e.dir === "in" && e.channel === "acp" && e.frame.method === "session/update")
    .map((e) => (e.frame.params as { update: Record<string, unknown> }).update)
}

/** Five frames copied verbatim from wire recordings (claude + pi-acp). */
export const RECORDED_XPROVIDER_FRAMES: Record<string, unknown>[] = [
  // pi-acp session_info_update — only _meta, no title
  { sessionUpdate: "session_info_update", _meta: { piAcp: { queueDepth: 0, running: true } } },
  // pi-acp agent_message_chunk
  {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "hi" },
    _meta: { piAcp: { notify: { level: "error" } } },
  },
  // claude usage_update
  {
    sessionUpdate: "usage_update",
    used: 49460,
    size: 200000,
    _meta: { "_claude/rateLimit": { status: "allowed" } },
  },
  // claude tool_call with parent link
  {
    _meta: { claudeCode: { toolName: "Bash", parentToolUseId: "toolu_PARENT" } },
    toolCallId: "toolu_CHILD",
    sessionUpdate: "tool_call",
    rawInput: {},
    status: "pending",
    title: "Terminal",
    kind: "execute",
    content: [],
  },
  // claude tool_call_update
  {
    _meta: { claudeCode: { toolName: "Bash", parentToolUseId: "toolu_PARENT" } },
    toolCallId: "toolu_CHILD",
    sessionUpdate: "tool_call_update",
    status: "completed",
  },
]

/** round-trip of the BE: raw update → reduce → applyPatch → patchToSessionUpdates. */
function roundTrip(
  state: SessionState,
  u: unknown,
): { state: SessionState; wire: WireSessionUpdate[] } {
  const { state: next, patches } = reduce(state, u)
  const wire: WireSessionUpdate[] = []
  let s = state
  for (const p of patches as Patch[]) {
    const applied = applyPatch(s, p)
    if (applied) {
      wire.push(...patchToSessionUpdates(applied, p))
      s = applied
    }
  }
  return { state: next, wire }
}

/** G-META — every top-level key in input `_meta` must deep-equal in some output update. */
function missingMetaKeys(
  input: Record<string, unknown>,
  wire: WireSessionUpdate[],
): string[] {
  const inMeta =
    typeof input._meta === "object" && input._meta !== null
      ? (input._meta as Record<string, unknown>)
      : undefined
  if (inMeta === undefined) return []

  const missing: string[] = []
  for (const key of Object.keys(inMeta)) {
    const expected = inMeta[key]
    const found = wire.some((w) => {
      const outMeta =
        typeof w._meta === "object" && w._meta !== null
          ? (w._meta as Record<string, unknown>)
          : undefined
      return outMeta !== undefined && JSON.stringify(outMeta[key]) === JSON.stringify(expected)
    })
    if (!found) missing.push(key)
  }
  return missing
}

/** G-KEYS — every top-level key except `_meta` must be reachable on the wire side. */
const KNOWN_UNMAPPED: { sessionUpdate: string; key: string; why: string }[] = [
  {
    sessionUpdate: "session_info_update",
    key: "updatedAt",
    why: "ACP session_info_update.updatedAt is not stored in SessionState",
  },
]

function missingNonMetaKeys(
  input: Record<string, unknown>,
  wire: WireSessionUpdate[],
): string[] {
  const outKeys = new Set<string>()
  for (const w of wire) {
    for (const k of Object.keys(w)) outKeys.add(k)
  }

  const missing: string[] = []
  for (const key of Object.keys(input)) {
    if (key === "_meta") continue
    if (outKeys.has(key)) continue
    const su = String(input.sessionUpdate ?? "")
    const waived = KNOWN_UNMAPPED.some((e) => e.sessionUpdate === su && e.key === key)
    if (!waived) missing.push(key)
  }
  return missing
}

function countPatches(updates: Record<string, unknown>[]): number {
  let state = createInitialSessionState({ sessionId: "noflood" })
  let total = 0
  for (const u of updates) {
    const { state: next, patches } = reduce(state, u)
    total += patches.length
    state = next
  }
  return total
}

// ─── gates ───

describe("meta-passthrough", () => {
  const recording = loadRecording()

  it("G-META — every _meta key on the recording survives round-trip", () => {
    let state = createInitialSessionState({ sessionId: "meta-gate" })
    const failures: string[] = []

    for (const u of recording) {
      const { state: next, wire } = roundTrip(state, u)
      state = next
      const missing = missingMetaKeys(u, wire)
      if (missing.length > 0) {
        failures.push(`${String(u.sessionUpdate)} missing _meta keys: [${missing.join(",")}]`)
      }
    }

    expect(failures, failures.join("\n")).toEqual([])
  })

  it("G-KEYS — recording: every top-level key except _meta is reachable (minus KNOWN_UNMAPPED)", () => {
    let state = createInitialSessionState({ sessionId: "keys-gate" })
    const failures: string[] = []

    for (const u of recording) {
      const { state: next, wire } = roundTrip(state, u)
      state = next
      const missing = missingNonMetaKeys(u, wire)
      if (missing.length > 0) {
        failures.push(`${String(u.sessionUpdate)} missing keys: [${missing.join(",")}]`)
      }
    }

    expect(failures, failures.join("\n")).toEqual([])
  })
})
