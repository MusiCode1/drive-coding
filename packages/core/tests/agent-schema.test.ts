import { describe, expect, it } from "vitest"
import { Agent, AgentPublic, CLI_KINDS, CreateAgentInput, toAgentPublic } from "../src"

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

  // slice open-cli-registry: cliKind הורחב ל-CliId (string) — הסכימה כבר לא דוחה
  // kind לא-מוכר; הדחייה עברה לולידציית ה-HTTP (getEffectiveCliSpecs, http-agents.ts).
  it("accepts a cliKind unknown to the built-in registry (rejection moved to HTTP)", () => {
    const result = CreateAgentInput({ cliKind: "vim", cwd: "/foo" })
    expect(result).not.toHaveProperty("summary")
  })

  it("rejects empty cliKind", () => {
    const result = CreateAgentInput({ cliKind: "", cwd: "/foo" })
    expect(result).toHaveProperty("summary")
  })

  it("modelOverride optional", () => {
    const result = CreateAgentInput({ cliKind: "claude", cwd: "/x" })
    expect(result).not.toHaveProperty("summary")
  })

  it("accepts all valid cliKinds", () => {
    for (const kind of CLI_KINDS) {
      const result = CreateAgentInput({ cliKind: kind, cwd: "/foo" })
      expect(result).not.toHaveProperty("summary")
    }
  })

  it("CLI_KINDS includes cursor and grok", () => {
    expect(CLI_KINDS).toContain("cursor")
    expect(CLI_KINDS).toContain("grok")
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

  // slice session-create-contract C1
  it("accepts permissionPolicy allow_once", () => {
    const result = CreateAgentInput({
      cliKind: "claude",
      cwd: "/x",
      permissionPolicy: "allow_once",
    })
    expect(result).toMatchObject({ permissionPolicy: "allow_once" })
  })

  it("rejects invalid permissionPolicy", () => {
    const result = CreateAgentInput({
      cliKind: "claude",
      cwd: "/x",
      permissionPolicy: "auto_allow",
    })
    expect(result).toHaveProperty("summary")
  })

  it("omitted permissionPolicy — valid (today's behavior)", () => {
    const result = CreateAgentInput({ cliKind: "claude", cwd: "/x" })
    expect(result).not.toHaveProperty("summary")
    expect(result).not.toHaveProperty("permissionPolicy")
  })

  // slice session-create-contract C2
  it("accepts env as string map", () => {
    const result = CreateAgentInput({
      cliKind: "cursor",
      cwd: "/x",
      env: { BDS_SLICE: "probe" },
    })
    expect(result).toMatchObject({ env: { BDS_SLICE: "probe" } })
  })

  it("omitted env — valid (today's behavior)", () => {
    const result = CreateAgentInput({ cliKind: "cursor", cwd: "/x" })
    expect(result).not.toHaveProperty("summary")
    expect(result).not.toHaveProperty("env")
  })

  // slice session-lifecycle-fields C0
  it("accepts parentAgentId", () => {
    const result = CreateAgentInput({
      cliKind: "cursor",
      cwd: "/x",
      parentAgentId: "parent-uuid",
    })
    expect(result).toMatchObject({ parentAgentId: "parent-uuid" })
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

  it("exposes parentAgentId (slice session-lifecycle-fields C0)", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440099",
      cliKind: "cursor" as const,
      cwd: "/foo",
      modelOverride: null,
      status: "ready" as const,
      createdAt: "2026-05-16T05:00:00.000Z",
      parentAgentId: "parent-1",
    }
    const pub = toAgentPublic(agent)
    expect(pub.parentAgentId).toBe("parent-1")
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

  // slice active-agents: persistent field
  it("accepts agent with persistent: true", () => {
    const result = Agent({
      id: "550e8400-e29b-41d4-a716-446655440002",
      cliKind: "opencode",
      cwd: "/foo",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-05-16T05:00:00.000Z",
      persistent: true,
    })
    expect(result).not.toHaveProperty("summary")
  })

  it("accepts agent without persistent (optional)", () => {
    const result = Agent({
      id: "550e8400-e29b-41d4-a716-446655440003",
      cliKind: "opencode",
      cwd: "/foo",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-05-16T05:00:00.000Z",
    })
    expect(result).not.toHaveProperty("summary")
  })
})

describe("toAgentPublic — persistent field (slice active-agents)", () => {
  it("copies persistent: true from agent to pub", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440004",
      cliKind: "opencode" as const,
      cwd: "/foo",
      modelOverride: null,
      status: "ready" as const,
      createdAt: "2026-05-16T05:00:00.000Z",
      persistent: true,
    }
    const pub = toAgentPublic(agent)
    expect(pub.persistent).toBe(true)
  })

  it("omits persistent from pub when not set on agent", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440005",
      cliKind: "gemini" as const,
      cwd: "/project",
      modelOverride: "gemini-pro",
      status: "busy" as const,
      createdAt: "2026-05-16T10:00:00.000Z",
    }
    const pub = toAgentPublic(agent)
    expect(pub).not.toHaveProperty("persistent")
    // existing test: toEqual still passes (no extra fields)
    expect(pub).toEqual(agent)
  })
})

// slice session-title-in-process-list: title field
describe("AgentPublic — title field", () => {
  it("accepts title as string", () => {
    const result = AgentPublic({
      id: "550e8400-e29b-41d4-a716-446655440006",
      cliKind: "opencode",
      cwd: "/foo",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-05-16T05:00:00.000Z",
      title: "מה זה TypeScript",
    })
    expect(result).not.toHaveProperty("summary")
  })

  it("accepts title as null", () => {
    const result = AgentPublic({
      id: "550e8400-e29b-41d4-a716-446655440007",
      cliKind: "opencode",
      cwd: "/foo",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-05-16T05:00:00.000Z",
      title: null,
    })
    expect(result).not.toHaveProperty("summary")
  })

  it("accepts agent without title (optional)", () => {
    const result = AgentPublic({
      id: "550e8400-e29b-41d4-a716-446655440008",
      cliKind: "opencode",
      cwd: "/foo",
      modelOverride: null,
      status: "ready",
      createdAt: "2026-05-16T05:00:00.000Z",
    })
    expect(result).not.toHaveProperty("summary")
  })
})

describe("toAgentPublic — title field (slice session-title-in-process-list)", () => {
  it("copies title from agent to pub", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440009",
      cliKind: "opencode" as const,
      cwd: "/foo",
      modelOverride: null,
      status: "ready" as const,
      createdAt: "2026-05-16T05:00:00.000Z",
      title: "מה זה TypeScript",
    }
    const pub = toAgentPublic(agent)
    expect(pub.title).toBe("מה זה TypeScript")
  })

  it("omits title from pub when not set on agent", () => {
    const agent = {
      id: "550e8400-e29b-41d4-a716-446655440010",
      cliKind: "gemini" as const,
      cwd: "/project",
      modelOverride: "gemini-pro",
      status: "busy" as const,
      createdAt: "2026-05-16T10:00:00.000Z",
    }
    const pub = toAgentPublic(agent)
    expect(pub).not.toHaveProperty("title")
    expect(pub).toEqual(agent)
  })
})
