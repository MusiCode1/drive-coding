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

function makeAgent(overrides: Partial<AgentPublic> & Pick<AgentPublic, "id">): AgentPublic {
  return { ...fakeAgent, ...overrides }
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

// ─── grouped (slice agent-tree-display C0) ───────────────────────────────────

function flatAgents(vm: ActiveAgents): AgentPublic[] {
  return vm.grouped.flatMap((g) => [g.root, ...g.children])
}

describe("ActiveAgents.grouped", () => {
  it("ללא parentAgentId — כל הסוכנים שורשים עם children ריקים (שער 1)", () => {
    const vm = new ActiveAgents()
    vm.agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" })]

    expect(vm.grouped).toEqual([
      { root: vm.agents[0], children: [] },
      { root: vm.agents[1], children: [] },
    ])
  })

  it("הורה + 2 ילדים — שורש אחד עם 2 ילדים (שער 2)", () => {
    const vm = new ActiveAgents()
    const parent = makeAgent({ id: "p" })
    const c1 = makeAgent({ id: "c1", parentAgentId: "p" })
    const c2 = makeAgent({ id: "c2", parentAgentId: "p" })
    vm.agents = [parent, c1, c2]

    expect(vm.grouped).toHaveLength(1)
    expect(vm.grouped[0]?.root.id).toBe("p")
    expect(vm.grouped[0]?.children.map((c) => c.id)).toEqual(["c1", "c2"])
  })

  it("מעגל-שניים — אף סוכן לא נעלם (שער 3)", () => {
    const vm = new ActiveAgents()
    vm.agents = [
      makeAgent({ id: "a", parentAgentId: "b" }),
      makeAgent({ id: "b", parentAgentId: "a" }),
    ]

    expect(flatAgents(vm)).toHaveLength(2)
    expect(flatAgents(vm).map((a) => a.id).sort()).toEqual(["a", "b"])
    for (const g of vm.grouped) {
      expect(g.children).toEqual([])
    }
  })

  it("מעגל-3 — כל הסוכנים נראים כשורשים-יחידים", () => {
    const vm = new ActiveAgents()
    vm.agents = [
      makeAgent({ id: "a", parentAgentId: "c" }),
      makeAgent({ id: "b", parentAgentId: "a" }),
      makeAgent({ id: "c", parentAgentId: "b" }),
    ]

    expect(flatAgents(vm)).toHaveLength(3)
    expect(vm.grouped.every((g) => g.children.length === 0)).toBe(true)
  })

  it("הורה שכבר נסגר — ילד מוצג כשורש (שער 4)", () => {
    const vm = new ActiveAgents()
    vm.agents = [makeAgent({ id: "child", parentAgentId: "gone" })]

    expect(vm.grouped).toEqual([{ root: vm.agents[0], children: [] }])
  })

  it("self-parent מזוהם — מוצג כשורש (שער 5)", () => {
    const vm = new ActiveAgents()
    vm.agents = [makeAgent({ id: "x", parentAgentId: "x" })]

    expect(vm.grouped).toEqual([{ root: vm.agents[0], children: [] }])
  })

  it("שלושה דורות — הנכד שורש נפרד (רמה אחת בלבד)", () => {
    const vm = new ActiveAgents()
    const parent = makeAgent({ id: "p" })
    const child = makeAgent({ id: "c", parentAgentId: "p" })
    const grand = makeAgent({ id: "g", parentAgentId: "c" })
    vm.agents = [parent, child, grand]

    expect(vm.grouped).toHaveLength(2)
    expect(vm.grouped[0]?.root.id).toBe("p")
    expect(vm.grouped[0]?.children.map((a) => a.id)).toEqual(["c"])
    expect(vm.grouped[1]?.root.id).toBe("g")
    expect(vm.grouped[1]?.children).toEqual([])
  })
})
