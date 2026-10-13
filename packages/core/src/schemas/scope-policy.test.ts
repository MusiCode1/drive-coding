/**
 * scope-policy.test.ts — classifier + env parse (C1 TDD).
 */

import { describe, expect, it } from "vitest"
import { configDefault } from "../config/specs.js"
import { RPC_METHODS } from "../session/rpc-methods.js"
import {
  classifyScopeAction,
  parseScopePolicyConfigLayer,
  parseScopePolicyValue,
  readScopePolicyFromEnv,
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

describe("parseScopePolicyConfigLayer", () => {
  it("invalid explicit env becomes ask", () => {
    expect(parseScopePolicyConfigLayer("ALLOW_ALL")).toBe("ask")
    expect(parseScopePolicyConfigLayer("ALLOW")).toBe("ask")
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
