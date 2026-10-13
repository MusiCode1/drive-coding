/**
 * scope-prompt-view.test.ts — pure FE mapping for scope escalation prompts (C4).
 */

import { describe, expect, it } from "vitest"
import type { PermissionParams } from "$lib/types/permission"
import { readScopePromptDetail, scopeDetailRows } from "./scope-prompt-view.js"

const detail = {
  caller: "A",
  target: "B",
  verb: "close",
  callerShortId: "aaaaaa",
  targetShortId: "bbbbbb",
}

function params(over: Partial<PermissionParams["toolCall"]> & { toolCallId: string }): PermissionParams {
  return {
    sessionId: "s1",
    toolCall: {
      title: "fallback",
      ...over,
    },
    options: [{ optionId: "o1", name: "Allow", kind: "allow_once" }],
  } as PermissionParams
}

describe("readScopePromptDetail", () => {
  it("returns detail when _meta and scope- prefix match", () => {
    const p = params({
      toolCallId: "scope-7",
      _meta: { "drive-coding/scope": detail },
    })
    expect(readScopePromptDetail(p)).toEqual(detail)
  })

  it("returns null when _meta present but toolCallId is not scope-", () => {
    const p = params({
      toolCallId: "tool-7",
      _meta: { "drive-coding/scope": detail },
    })
    expect(readScopePromptDetail(p)).toBeNull()
  })

  it("returns null for scope- prefix without _meta", () => {
    expect(readScopePromptDetail(params({ toolCallId: "scope-7" }))).toBeNull()
  })

  it("returns null for malformed _meta without throwing", () => {
    const p = params({
      toolCallId: "scope-1",
      _meta: { "drive-coding/scope": { caller: 1 } },
    })
    expect(readScopePromptDetail(p)).toBeNull()
  })
})

describe("scopeDetailRows", () => {
  const t = (key: string) => key

  it("falls back to raw verb when not in map", () => {
    const rows = scopeDetailRows({ ...detail, verb: "session/prompt" }, t)
    const action = rows.find((r) => r.label === "scopePrompt.action")
    expect(action?.kind !== "countdown" && action?.value).toBe("session/prompt")
  })

  it("adds countdown row when expiresAtMs is set", () => {
    const rows = scopeDetailRows({ ...detail, expiresAtMs: 1_700_000_000_000 }, t)
    expect(rows).toHaveLength(4)
    expect(rows[3]).toEqual({
      label: "scopePrompt.expiresIn",
      kind: "countdown",
      expiresAtMs: 1_700_000_000_000,
    })
  })

  it("keeps three rows without expiresAtMs", () => {
    expect(scopeDetailRows(detail, t)).toHaveLength(3)
  })

  it("still adds countdown when expiresAtMs is in the past", () => {
    const rows = scopeDetailRows({ ...detail, expiresAtMs: 1 }, t)
    expect(rows[3]?.kind).toBe("countdown")
  })
})
