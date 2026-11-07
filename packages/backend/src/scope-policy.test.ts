/**
 * scope-policy.test.ts — BE runtime snapshot + overrides (C1).
 */

import { afterEach, describe, expect, it } from "vitest"
import type { Agent } from "@drive-coding/core"
import {
  escalationPolicyForCaller,
  escalationPolicyForVerb,
  getScopePolicySnapshot,
  resetScopePolicyForTests,
  setScopePolicyOverride,
} from "./scope-policy.js"

describe("getScopePolicySnapshot", () => {
  afterEach(() => {
    resetScopePolicyForTests()
  })

  it("defaults to ask with source default when env unset", () => {
    const snap = getScopePolicySnapshot({} as NodeJS.ProcessEnv)
    expect(snap.policies).toEqual({ message: "ask", update: "ask", close: "ask" })
    expect(snap.sources).toEqual({ message: "default", update: "default", close: "default" })
  })

  it("reads valid env as source env", () => {
    const snap = getScopePolicySnapshot({
      SCOPE_MESSAGE_POLICY: "allow",
      SCOPE_UPDATE_POLICY: "deny",
    } as NodeJS.ProcessEnv)
    expect(snap.policies.message).toBe("allow")
    expect(snap.sources.message).toBe("env")
    expect(snap.policies.update).toBe("deny")
    expect(snap.sources.update).toBe("env")
    expect(snap.policies.close).toBe("ask")
    expect(snap.sources.close).toBe("default")
  })

  it("invalid uppercase env falls back to configDefault, not env source", () => {
    const snap = getScopePolicySnapshot({
      SCOPE_MESSAGE_POLICY: "ALLOW",
    } as NodeJS.ProcessEnv)
    expect(snap.policies.message).toBe("ask")
    expect(snap.sources.message).toBe("default")
  })

  it("override wins over env", () => {
    process.env.SCOPE_CLOSE_POLICY = "allow"
    setScopePolicyOverride({ close: "deny" })
    const snap = getScopePolicySnapshot()
    expect(snap.policies.close).toBe("deny")
    expect(snap.sources.close).toBe("override")
  })
})

describe("escalationPolicyForVerb", () => {
  afterEach(() => resetScopePolicyForTests())

  it("unclassified verbs stay ask even when all groups allow", () => {
    setScopePolicyOverride({ message: "allow", update: "allow", close: "allow" })
    expect(escalationPolicyForVerb("totally-unknown")).toBe("ask")
    expect(escalationPolicyForVerb("_drive/ext")).toBe("ask")
  })
})

describe("escalationPolicyForCaller", () => {
  afterEach(() => resetScopePolicyForTests())

  const caller = (scopePolicies: Agent["scopePolicies"]): Agent =>
    ({
      id: "550e8400-e29b-41d4-a716-446655440000",
      cliKind: "cursor",
      cwd: "/tmp",
      modelOverride: null,
      status: "ready",
      createdAt: new Date().toISOString(),
      scopePolicies,
    }) as Agent

  it("per-caller allow overrides global ask for classified verbs", () => {
    setScopePolicyOverride({ message: "ask" })
    expect(escalationPolicyForCaller("send", caller({ message: "allow" }))).toBe("allow")
  })

  it("per-caller deny overrides global allow", () => {
    setScopePolicyOverride({ close: "allow" })
    expect(escalationPolicyForCaller("close", caller({ close: "deny" }))).toBe("deny")
  })

  it("unclassified verb stays ask even when per-caller message is allow", () => {
    setScopePolicyOverride({ message: "ask", update: "ask", close: "ask" })
    expect(escalationPolicyForCaller("_drive/ext", caller({ message: "allow" }))).toBe("ask")
  })
})
