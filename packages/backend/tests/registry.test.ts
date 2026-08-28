import type { AgentRegistry } from "@drive-coding/core"
import { beforeEach, describe, expect, it } from "vitest"
import { createInMemoryAgentRegistry } from "../src/agents/registry"

describe("InMemoryAgentRegistry", () => {
  let registry: AgentRegistry

  beforeEach(() => {
    registry = createInMemoryAgentRegistry()
  })

  it("creates agent with status=ready (Slice 2 stub)", async () => {
    const agent = await registry.create({ cliKind: "opencode", cwd: "/foo" })
    expect(agent.status).toBe("ready")
    expect(agent.cliKind).toBe("opencode")
    expect(agent.cwd).toBe("/foo")
    expect(agent.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(agent.modelOverride).toBeNull()
  })

  it("retrieves created agent", async () => {
    const created = await registry.create({ cliKind: "claude", cwd: "/x" })
    const fetched = await registry.get(created.id)
    expect(fetched).toEqual(created)
  })

  it("returns null for unknown id", async () => {
    expect(await registry.get("00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  it("lists all agents", async () => {
    await registry.create({ cliKind: "opencode", cwd: "/a" })
    await registry.create({ cliKind: "gemini", cwd: "/b" })
    const list = await registry.list()
    expect(list).toHaveLength(2)
  })

  it("lists empty registry", async () => {
    const list = await registry.list()
    expect(list).toHaveLength(0)
  })

  it("updates status", async () => {
    const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
    const updated = await registry.update(agent.id, { status: "busy" })
    expect(updated.status).toBe("busy")
    expect((await registry.get(agent.id))?.status).toBe("busy")
  })

  it("throws on update of unknown id", async () => {
    await expect(registry.update("invalid-id", { status: "busy" })).rejects.toThrow()
  })

  it("deletes agent", async () => {
    const agent = await registry.create({ cliKind: "opencode", cwd: "/x" })
    await registry.delete(agent.id)
    expect(await registry.get(agent.id)).toBeNull()
  })

  it("throws on delete of unknown id", async () => {
    await expect(registry.delete("invalid-id")).rejects.toThrow()
  })

  it("stores modelOverride correctly", async () => {
    const agent = await registry.create({
      cliKind: "claude",
      cwd: "/x",
      modelOverride: "claude-sonnet-4",
    })
    expect(agent.modelOverride).toBe("claude-sonnet-4")
    const fetched = await registry.get(agent.id)
    expect(fetched?.modelOverride).toBe("claude-sonnet-4")
  })

  it("stores parentAgentId (slice session-lifecycle-fields C0)", async () => {
    const agent = await registry.create({
      cliKind: "cursor",
      cwd: "/x",
      parentAgentId: "parent-agent-1",
    })
    expect(agent.parentAgentId).toBe("parent-agent-1")
    const fetched = await registry.get(agent.id)
    expect(fetched?.parentAgentId).toBe("parent-agent-1")
  })

  it("stores closeOnTurnEnd (slice session-lifecycle-fields C1)", async () => {
    const agent = await registry.create({
      cliKind: "cursor",
      cwd: "/x",
      closeOnTurnEnd: true,
    })
    expect(agent.closeOnTurnEnd).toBe(true)
    const fetched = await registry.get(agent.id)
    expect(fetched?.closeOnTurnEnd).toBe(true)
  })
})
