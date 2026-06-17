/**
 * active-agents.svelte.test.ts — TDD עבור Commit 1: VM ActiveAgents.
 *
 * approach: tdd (Red-Green-Refactor).
 * כל המתודות מוcked ב-adapters/agents-api.
 *
 * בדיקות (לפי brief §4):
 *  - refresh() ממלא agents מ-listAgents, מאפס loading.
 *  - refresh() על שגיאה → error מאוכלס, לא זורק.
 *  - setPersistent(id,true) קורא ל-adapter ואז refresh.
 *  - kill(id) קורא ל-deleteAgent ואז refresh.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { AgentPublic } from "@drive-coding/core"

// ─── mock agents-api ──────────────────────────────────────────────────────────
vi.mock("$lib/adapters/agents-api", () => ({
  listAgents: vi.fn(),
  deleteAgent: vi.fn(),
  setAgentPersistent: vi.fn(),
}))

import { listAgents, deleteAgent, setAgentPersistent } from "$lib/adapters/agents-api"
import { ActiveAgents } from "./active-agents.svelte"

const mockListAgents = listAgents as ReturnType<typeof vi.fn>
const mockDeleteAgent = deleteAgent as ReturnType<typeof vi.fn>
const mockSetAgentPersistent = setAgentPersistent as ReturnType<typeof vi.fn>

const fakeAgent: AgentPublic = {
  id: "agent-1",
  cliKind: "opencode",
  cwd: "/tmp/project",
  modelOverride: null,
  status: "ready",
  createdAt: new Date().toISOString(),
  persistent: false,
  attached: false,
  acpSessionId: "session-abc123",
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── refresh ──────────────────────────────────────────────────────────────────

describe("ActiveAgents.refresh()", () => {
  it("ממלא agents מ-listAgents ומאפס loading", async () => {
    mockListAgents.mockResolvedValue([fakeAgent])
    const vm = new ActiveAgents()

    await vm.refresh()

    expect(vm.agents).toEqual([fakeAgent])
    expect(vm.loading).toBe(false)
    expect(vm.error).toBeNull()
  })

  it("אחרי refresh loading חוזר ל-false", async () => {
    mockListAgents.mockResolvedValue([])
    const vm = new ActiveAgents()

    const promise = vm.refresh()
    // אפשר לבדוק loading=true בתוך ה-promise (לא חובה — נבדוק שבסוף false)
    await promise

    expect(vm.loading).toBe(false)
  })

  it("שגיאה ב-listAgents → error מאוכלס, לא זורק, agents נשאר ריק", async () => {
    mockListAgents.mockRejectedValue(new Error("network error"))
    const vm = new ActiveAgents()

    await expect(vm.refresh()).resolves.toBeUndefined()

    expect(vm.error).toBe("network error")
    expect(vm.agents).toEqual([])
    expect(vm.loading).toBe(false)
  })

  it("שגיאה לא-Error → error מאוכלס כ-String(e)", async () => {
    mockListAgents.mockRejectedValue("boom")
    const vm = new ActiveAgents()

    await vm.refresh()

    expect(vm.error).toBe("boom")
  })
})

// ─── setPersistent ────────────────────────────────────────────────────────────

describe("ActiveAgents.setPersistent()", () => {
  it("קורא ל-setAgentPersistent(id, true) ואז refresh", async () => {
    mockSetAgentPersistent.mockResolvedValue(undefined)
    mockListAgents.mockResolvedValue([{ ...fakeAgent, persistent: true }])
    const vm = new ActiveAgents()

    await vm.setPersistent("agent-1", true)

    expect(mockSetAgentPersistent).toHaveBeenCalledWith("agent-1", true)
    expect(mockSetAgentPersistent).toHaveBeenCalledTimes(1)
    expect(mockListAgents).toHaveBeenCalledTimes(1)
    expect(vm.agents[0]?.persistent).toBe(true)
  })

  it("קורא ל-setAgentPersistent(id, false) לביטול נעיצה", async () => {
    mockSetAgentPersistent.mockResolvedValue(undefined)
    mockListAgents.mockResolvedValue([{ ...fakeAgent, persistent: false }])
    const vm = new ActiveAgents()

    await vm.setPersistent("agent-1", false)

    expect(mockSetAgentPersistent).toHaveBeenCalledWith("agent-1", false)
  })
})

// ─── kill ─────────────────────────────────────────────────────────────────────

describe("ActiveAgents.kill()", () => {
  it("קורא ל-deleteAgent(id) ואז refresh", async () => {
    mockDeleteAgent.mockResolvedValue(undefined)
    mockListAgents.mockResolvedValue([])
    const vm = new ActiveAgents()

    await vm.kill("agent-1")

    expect(mockDeleteAgent).toHaveBeenCalledWith("agent-1")
    expect(mockDeleteAgent).toHaveBeenCalledTimes(1)
    expect(mockListAgents).toHaveBeenCalledTimes(1)
    expect(vm.agents).toEqual([])
  })
})
