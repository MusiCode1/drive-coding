import { describe, expect, it } from "vitest"
import { parseCreateAgentBody } from "./create-agent-input.js"

describe("parseCreateAgentBody — roleLabel (slice agent-role-label C1)", () => {
  it("copies roleLabel when set", () => {
    const result = parseCreateAgentBody(
      {
        cliKind: "cursor",
        cwd: "/tmp",
        roleLabel: "planner",
      },
      {},
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.roleLabel).toBe("planner")
  })

  it("omits roleLabel when empty string", () => {
    const result = parseCreateAgentBody(
      {
        cliKind: "cursor",
        cwd: "/tmp",
        roleLabel: "",
      },
      {},
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).not.toHaveProperty("roleLabel")
  })

  it("omits roleLabel when absent", () => {
    const result = parseCreateAgentBody(
      {
        cliKind: "cursor",
        cwd: "/tmp",
      },
      {},
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).not.toHaveProperty("roleLabel")
  })
})

describe("parseCreateAgentBody — detachedFromParent (slice detached-agent-flag C1)", () => {
  it("copies detachedFromParent when true", () => {
    const result = parseCreateAgentBody(
      {
        cliKind: "cursor",
        cwd: "/tmp",
        detachedFromParent: true,
      },
      {},
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.detachedFromParent).toBe(true)
  })

  it("omits detachedFromParent when false", () => {
    const result = parseCreateAgentBody(
      {
        cliKind: "cursor",
        cwd: "/tmp",
        detachedFromParent: false,
      },
      {},
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).not.toHaveProperty("detachedFromParent")
  })
})
