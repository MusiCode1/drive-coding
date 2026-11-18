/**
 * scope-prompt.test.ts — TDD for scope escalation display helpers (slice scope-prompt-detail C0).
 */

import { describe, expect, it } from "vitest"
import {
  buildScopePromptDetail,
  describeScopeParty,
  formatScopePromptTitle,
  shortAgentId,
} from "./scope-prompt.js"

describe("describeScopeParty", () => {
  it("uses roleLabel alone", () => {
    expect(describeScopeParty({ id: "00000000-0000-4000-8000-000000000001", roleLabel: "planner" })).toBe(
      "planner",
    )
  })

  it("uses title when no roleLabel", () => {
    expect(
      describeScopeParty({
        id: "00000000-0000-4000-8000-000000000002",
        title: "My session",
      }),
    ).toBe("My session")
  })

  it("prefers roleLabel over title", () => {
    expect(
      describeScopeParty({
        id: "00000000-0000-4000-8000-000000000003",
        roleLabel: "executor",
        title: "ignored",
      }),
    ).toBe("executor")
  })

  it("uses cliKind and cwd basename", () => {
    expect(
      describeScopeParty({
        id: "00000000-0000-4000-8000-000000000004",
        cliKind: "claude",
        cwd: "/home/u/my-proj",
      }),
    ).toBe("claude · my-proj")
  })

  it("strips trailing slash from cwd", () => {
    expect(
      describeScopeParty({
        id: "00000000-0000-4000-8000-000000000005",
        cliKind: "claude",
        cwd: "/home/u/my-proj/",
      }),
    ).toBe("claude · my-proj")
  })

  it("treats empty title as missing", () => {
    expect(
      describeScopeParty({
        id: "00000000-0000-4000-8000-000000000006",
        title: "",
        cliKind: "cursor",
      }),
    ).toBe("cursor")
  })

  it("treats whitespace title as missing", () => {
    expect(
      describeScopeParty({
        id: "00000000-0000-4000-8000-000000000007",
        title: "   ",
        cliKind: "cursor",
      }),
    ).toBe("cursor")
  })

  it("treats null title as missing", () => {
    expect(
      describeScopeParty({
        id: "00000000-0000-4000-8000-000000000008",
        title: null,
        cliKind: "opencode",
      }),
    ).toBe("opencode")
  })

  it("never contains the full id when no display fields", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890"
    expect(describeScopeParty({ id })).not.toContain(id)
    expect(describeScopeParty({ id })).toBe("abcdef")
  })
})

describe("buildScopePromptDetail", () => {
  it("uses agent list for both sides", () => {
    const detail = buildScopePromptDetail({
      callerId: "a",
      targetId: "b",
      verb: "close",
      agents: [
        { id: "a", roleLabel: "caller-role" },
        { id: "b", title: "target-title" },
      ],
    })
    expect(detail.caller).toBe("caller-role")
    expect(detail.target).toBe("target-title")
    expect(detail.verb).toBe("close")
  })

  it("does not throw when caller missing from agents", () => {
    const id = "abcdef12-3456-7890-abcd-ef1234567890"
    const detail = buildScopePromptDetail({
      callerId: id,
      targetId: "b",
      verb: "patch",
      agents: [{ id: "b", title: "B" }],
    })
    expect(detail.caller).not.toContain(id)
    expect(detail.target).toBe("B")
  })
})

describe("shortAgentId", () => {
  it("returns short ids unchanged", () => {
    expect(shortAgentId("abc")).toBe("abc")
  })
})

describe("formatScopePromptTitle", () => {
  it("returns non-empty string containing verb", () => {
    const s = formatScopePromptTitle({
      caller: "A",
      target: "B",
      verb: "close",
      callerShortId: "aaaaaa",
      targetShortId: "bbbbbb",
    })
    expect(s.length).toBeGreaterThan(0)
    expect(s).toContain("close")
  })
})
