/**
 * agent-scope.test.ts — unit tests for scope token + subtree (C0/C2).
 */

import { afterEach, describe, expect, it } from "vitest"
import {
  DC_MASTER_KEY_ENV,
  DC_SCOPE_SECRET_ENV,
  DC_TOKEN_ENV,
  getScopeSecret,
  issueToken,
  isMaster,
  resetScopeSecretForTests,
  SCOPE_HEADER,
  subtreeIds,
  verifyToken,
} from "./agent-scope.js"

describe("SCOPE_HEADER / DC_TOKEN_ENV", () => {
  it("exports stable names", () => {
    expect(SCOPE_HEADER).toBe("X-Drive-Coding-Scope")
    expect(DC_TOKEN_ENV).toBe("DC_TOKEN")
  })
})

describe("getScopeSecret", () => {
  afterEach(() => {
    delete process.env[DC_SCOPE_SECRET_ENV]
    resetScopeSecretForTests()
  })

  it("returns env value when set", () => {
    process.env[DC_SCOPE_SECRET_ENV] = "test-secret"
    resetScopeSecretForTests()
    expect(getScopeSecret()).toBe("test-secret")
  })

  it("generates a stable in-memory secret when env is missing", () => {
    delete process.env[DC_SCOPE_SECRET_ENV]
    resetScopeSecretForTests()
    const a = getScopeSecret()
    const b = getScopeSecret()
    expect(a.length).toBeGreaterThan(8)
    expect(a).toBe(b)
  })
})

describe("issueToken / verifyToken", () => {
  const secret = "unit-test-secret"

  it("round-trips agentId", () => {
    const token = issueToken("agent-a", secret)
    expect(verifyToken(token, secret)).toEqual({ agentId: "agent-a" })
  })

  it("rejects tampered payload", () => {
    const token = issueToken("agent-a", secret)
    const [payload] = token.split(".")
    const tampered = `${payload}x.${token.split(".")[1]}`
    expect(verifyToken(tampered, secret)).toBeUndefined()
  })

  it("rejects wrong secret", () => {
    const token = issueToken("agent-a", secret)
    expect(verifyToken(token, "other-secret")).toBeUndefined()
  })
})

describe("isMaster", () => {
  afterEach(() => {
    delete process.env[DC_MASTER_KEY_ENV]
  })

  it("true when token equals DC_MASTER_KEY", () => {
    process.env[DC_MASTER_KEY_ENV] = "master-key"
    expect(isMaster("master-key")).toBe(true)
    expect(isMaster("other")).toBe(false)
  })

  it("false when token is undefined", () => {
    expect(isMaster(undefined)).toBe(false)
  })
})

describe("subtreeIds", () => {
  const agents = [
    { id: "A", parentAgentId: undefined },
    { id: "B", parentAgentId: "A" },
    { id: "C", parentAgentId: "A" },
    { id: "D", parentAgentId: "B" },
    { id: "Z", parentAgentId: undefined },
  ]

  it("includes root and all descendants", () => {
    expect(subtreeIds(agents, "A")).toEqual(new Set(["A", "B", "C", "D"]))
  })

  it("includes only root when no children", () => {
    expect(subtreeIds(agents, "Z")).toEqual(new Set(["Z"]))
  })

  it("handles cycles without looping forever", () => {
    const cyclic = [
      { id: "X", parentAgentId: "Y" },
      { id: "Y", parentAgentId: "X" },
    ]
    const result = subtreeIds(cyclic, "X")
    expect(result.has("X")).toBe(true)
    expect(result.has("Y")).toBe(true)
    expect(result.size).toBeLessThanOrEqual(21)
  })
})
