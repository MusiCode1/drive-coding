import { describe, expect, it } from "vitest"
import { Agent, CreateAgentInput, toAgentPublic } from "../src"

describe("CreateAgentInput", () => {
  it("accepts valid input", () => {
    const result = CreateAgentInput({
      cliKind: "opencode",
      cwd: "/home/user/foo",
    })
    expect(result).toMatchObject({ cliKind: "opencode", cwd: "/home/user/foo" })
  })

  it("rejects empty cwd", () => {
    const result = CreateAgentInput({ cliKind: "opencode", cwd: "" })
    expect(result).toHaveProperty("summary")
  })

  it("rejects invalid cliKind", () => {
    const result = CreateAgentInput({ cliKind: "vim", cwd: "/foo" } as never)
    expect(result).toHaveProperty("summary")
  })

  it("modelOverride optional", () => {
    const result = CreateAgentInput({ cliKind: "claude", cwd: "/x" })
    expect(result).not.toHaveProperty("summary")
  })

  it("accepts all valid cliKinds", () => {
    for (const kind of ["opencode", "claude", "gemini", "codex"] as const) {
      const result = CreateAgentInput({ cliKind: kind, cwd: "/foo" })
      expect(result).not.toHaveProperty("summary")
    }
  })

  it("accepts modelOverride as string", () => {
    const result = CreateAgentInput({
      cliKind: "claude",
      cwd: "/x",
      modelOverride: "claude-sonnet-4",
    })
    expect(result).toMatchObject({ modelOverride: "claude-sonnet-4" })
  })

  it("accepts modelOverride as null", () => {
    const result = CreateAgentInput({
      cliKind: "gemini",
      cwd: "/x",
      modelOverride: null,
    })
    expect(result).toMatchObject({ modelOverride: null })
  })
})

describe("toAgentPublic", () => {
  it("strips bridge fields but exposes acpSessionId (Slice 10)", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      cliKind: "opencode" as const,
      cwd: "/foo",
      modelOverride: null,
      status: "ready" as const,
      createdAt: "2026-05-16T05:00:00.000Z",
      bridgePort: 7100,
      acpSessionId: "sess_abc",
    }
    const pub = toAgentPublic(agent)
    expect(pub).not.toHaveProperty("bridgePort")
    // Slice 10: acpSessionId IS exposed — FE needs it to call loadSession() on reload
    // (instead of newSession() which would conflict with existing BE-registered session).
    expect(pub.acpSessionId).toBe("sess_abc")
    expect(pub).toMatchObject({
      id: agent.id,
      cliKind: "opencode",
      status: "ready",
    })
  })

  it("preserves all public fields", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      cliKind: "gemini" as const,
      cwd: "/project",
      modelOverride: "gemini-pro",
      status: "busy" as const,
      createdAt: "2026-05-16T10:00:00.000Z",
    }
    const pub = toAgentPublic(agent)
    expect(pub).toEqual(agent)
  })
})

describe("Agent schema", () => {
  it("validates a complete agent object", () => {
    const result = Agent({
      id: "550e8400-e29b-41d4-a716-446655440000",
      cliKind: "opencode",
      cwd: "/foo",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-05-16T05:00:00.000Z",
    })
    expect(result).not.toHaveProperty("summary")
  })

  it("rejects invalid uuid", () => {
    const result = Agent({
      id: "not-a-uuid",
      cliKind: "opencode",
      cwd: "/foo",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-05-16T05:00:00.000Z",
    })
    expect(result).toHaveProperty("summary")
  })
})
