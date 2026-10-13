/**
 * scope-policy.test.ts — classifier + env parse (C1 TDD).
 */

import { describe, expect, it } from "vitest"
import { configDefault } from "../config/specs.js"
import { RPC_METHODS } from "../session/rpc-methods.js"
import { type } from "arktype"
import {
  classifyScopeAction,
  parseScopePolicyValue,
  readScopePolicyFromEnv,
  resolveScopePolicy,
  resolveScopePolicySource,
  ScopePolicyPerAgentPatchBodySchema,
  ScopePolicyPatchBodySchema,
  ScopePolicySnapshotSchema,
  type ScopePolicy,
} from "./scope-policy.js"

describe("classifyScopeAction", () => {
  it("maps message verbs", () => {
    expect(classifyScopeAction("send")).toBe("message")
    expect(classifyScopeAction(RPC_METHODS.prompt)).toBe("message")
    expect(classifyScopeAction("prompt")).toBe("message")
  })

  it("maps update verbs", () => {
    expect(classifyScopeAction("patch")).toBe("update")
    expect(classifyScopeAction("reply")).toBe("update")
    expect(classifyScopeAction(RPC_METHODS.setConfigOption)).toBe("update")
    expect(classifyScopeAction(RPC_METHODS.extMethod)).toBeUndefined()
    expect(classifyScopeAction(RPC_METHODS.cancel)).toBe("update")
  })

  it("maps close verbs", () => {
    expect(classifyScopeAction("close")).toBe("close")
    expect(classifyScopeAction(RPC_METHODS.deleteSession)).toBe("close")
  })

  it("returns undefined for list and unknown", () => {
    expect(classifyScopeAction(RPC_METHODS.listSessions)).toBeUndefined()
    expect(classifyScopeAction("session/nope")).toBeUndefined()
    expect(classifyScopeAction("totally-unknown")).toBeUndefined()
  })
})

describe("parseScopePolicyValue", () => {
  it("accepts exact lowercase ask/allow/deny with surrounding trim", () => {
    expect(parseScopePolicyValue("allow")).toBe("allow")
    expect(parseScopePolicyValue(" ask ")).toBe("ask")
  })

  it("returns undefined for uppercase, empty, or garbage", () => {
    expect(parseScopePolicyValue("ALLOW")).toBeUndefined()
    expect(parseScopePolicyValue("")).toBeUndefined()
    expect(parseScopePolicyValue("  ")).toBeUndefined()
    expect(parseScopePolicyValue("maybe")).toBeUndefined()
  })
})

describe("ScopePolicyPatchBodySchema", () => {
  it("rejects foreign keys under policies and at top level", () => {
    const nested = ScopePolicyPatchBodySchema({
      policies: { message: "ask", alien: "deny" },
    })
    expect(nested instanceof type.errors).toBe(true)

    const top = ScopePolicyPatchBodySchema({
      policies: { message: "ask" },
      extra: true,
    })
    expect(top instanceof type.errors).toBe(true)
  })

  it("rejects mixed invalid enum atomically", () => {
    const mixed = ScopePolicyPatchBodySchema({
      policies: { message: "allow", update: "ALLOW" },
    })
    expect(mixed instanceof type.errors).toBe(true)
  })

  it("accepts partial valid patch keys only", () => {
    const ok = ScopePolicyPatchBodySchema({ policies: { close: "deny" } })
    expect(ok instanceof type.errors).toBe(false)
    if (ok instanceof type.errors) return
    expect(ok.policies.close).toBe("deny")
  })
})

describe("ScopePolicySnapshotSchema", () => {
  it("rejects undeclared keys on snapshot shape", () => {
    const bad = ScopePolicySnapshotSchema({
      policies: { message: "ask", update: "ask", close: "ask", extra: "allow" },
      sources: { message: "default", update: "default", close: "default" },
    })
    expect(bad instanceof type.errors).toBe(true)
  })
})

describe("resolveScopePolicy", () => {
  const globals: ScopePolicy[] = ["ask", "allow", "deny"]

  it("covers all 9 global×perCaller combinations", () => {
    const expected: Record<string, ScopePolicy> = {
      "ask:ask": "ask",
      "ask:allow": "allow",
      "ask:deny": "deny",
      "allow:ask": "ask",
      "allow:allow": "allow",
      "allow:deny": "deny",
      "deny:ask": "deny",
      "deny:allow": "deny",
      "deny:deny": "deny",
    }
    for (const global of globals) {
      for (const perCaller of ["ask", "allow", "deny"] as const) {
        expect(resolveScopePolicy({ global, perCaller })).toBe(expected[`${global}:${perCaller}`])
      }
    }
  })

  it("inherits global when perCaller is absent", () => {
    expect(resolveScopePolicy({ global: "ask", perCaller: undefined })).toBe("ask")
    expect(resolveScopePolicy({ global: "allow", perCaller: undefined })).toBe("allow")
    expect(resolveScopePolicy({ global: "deny", perCaller: undefined })).toBe("deny")
  })
})

describe("resolveScopePolicySource", () => {
  it("uses agent source when per-caller deny or explicit override wins", () => {
    expect(
      resolveScopePolicySource({
        global: "allow",
        globalSource: "default",
        perCaller: "deny",
      }),
    ).toBe("agent")
    expect(
      resolveScopePolicySource({
        global: "ask",
        globalSource: "env",
        perCaller: "allow",
      }),
    ).toBe("agent")
  })

  it("keeps global source when global deny wins over per-caller allow", () => {
    expect(
      resolveScopePolicySource({
        global: "deny",
        globalSource: "override",
        perCaller: "allow",
      }),
    ).toBe("override")
  })

  it("inherits global source when perCaller absent", () => {
    expect(
      resolveScopePolicySource({
        global: "ask",
        globalSource: "default",
        perCaller: undefined,
      }),
    ).toBe("default")
  })
})

describe("ScopePolicyPerAgentPatchBodySchema", () => {
  it("accepts null to clear a per-caller key", () => {
    const ok = ScopePolicyPerAgentPatchBodySchema({
      agent: "550e8400-e29b-41d4-a716-446655440000",
      policies: { message: null },
    })
    expect(ok instanceof type.errors).toBe(false)
  })

  it("rejects foreign keys", () => {
    const bad = ScopePolicyPerAgentPatchBodySchema({
      agent: "550e8400-e29b-41d4-a716-446655440000",
      policies: { message: "ask", extra: "deny" },
    })
    expect(bad instanceof type.errors).toBe(true)
  })
})

describe("readScopePolicyFromEnv", () => {
  it("reads valid lowercase env keys", () => {
    const env = {
      SCOPE_MESSAGE_POLICY: "allow",
      SCOPE_UPDATE_POLICY: "deny",
      SCOPE_CLOSE_POLICY: "ask",
    }
    expect(readScopePolicyFromEnv("message", env)).toBe("allow")
    expect(readScopePolicyFromEnv("update", env)).toBe("deny")
    expect(readScopePolicyFromEnv("close", env)).toBe("ask")
  })

  it("product defaults live only on CONFIG_SPECS", () => {
    expect(configDefault("scopeMessagePolicy")).toBe("ask")
    expect(configDefault("scopeUpdatePolicy")).toBe("ask")
    expect(configDefault("scopeClosePolicy")).toBe("ask")
  })
})
