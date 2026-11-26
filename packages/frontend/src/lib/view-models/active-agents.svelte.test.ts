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

import type { AgentPublic } from "@drive-coding/core"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── mock agents-api ──────────────────────────────────────────────────────────
vi.mock("$lib/adapters/agents-api", () => ({
  listAgents: vi.fn(),
  deleteAgent: vi.fn(),
  setAgentPersistent: vi.fn(),
}))

import { deleteAgent, listAgents, setAgentPersistent } from "$lib/adapters/agents-api"
import { _setPageHiddenForTest } from "$lib/util/page-visibility.svelte"
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

function pendingList() {
  let resolve: (agents: AgentPublic[]) => void = () => {}
  const promise = new Promise<AgentPublic[]>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("ActiveAgents.tree", () => {
  it("derives a stable tree once per successful list snapshot", async () => {
    mockListAgents.mockResolvedValue([
      makeAgent({ id: "root" }),
      makeAgent({ id: "child", parentAgentId: "root" }),
      makeAgent({ id: "grandchild", parentAgentId: "child", busy: true }),
    ])
    const vm = new ActiveAgents()
    expect(vm.hasSnapshot).toBe(false)
    await vm.refresh()

    const tree = vm.tree
    expect(vm.tree).toBe(tree)
    expect(vm.hasSnapshot).toBe(true)
    expect(tree.preOrder.map((node) => node.agent.id)).toEqual(["root", "child", "grandchild"])
    expect(tree.byId.get("root")?.busyDescendantCount).toBe(1)

    mockListAgents.mockRejectedValueOnce(new Error("offline"))
    await vm.refresh()
    expect(vm.tree).toBe(tree)
    expect(vm.hasSnapshot).toBe(true)

    mockListAgents.mockResolvedValue([])
    await vm.refresh()
    expect(vm.tree).not.toBe(tree)
    expect(vm.tree.roots).toEqual([])
    expect(vm.hasSnapshot).toBe(true)
  })
})

describe("ActiveAgents shared refresh", () => {
  it("joins the in-flight home GET and reuses its fresh result on a later mount", async () => {
    vi.useFakeTimers()
    const first = pendingList()
    mockListAgents.mockReturnValueOnce(first.promise).mockResolvedValue([])
    const vm = new ActiveAgents()
    const home = vm.refresh()
    const stop = vm.subscribe()
    try {
      expect(mockListAgents).toHaveBeenCalledTimes(1)
      first.resolve([])
      await home
      const stopFresh = vm.subscribe()
      stopFresh()
      expect(mockListAgents).toHaveBeenCalledTimes(1)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it("refreshes upon mount when the previous snapshot is stale", async () => {
    vi.useFakeTimers()
    const vm = new ActiveAgents()
    mockListAgents.mockResolvedValue([])
    await vm.refresh()
    vi.setSystemTime(Date.now() + 12_000)
    const stop = vm.subscribe()
    try {
      expect(mockListAgents).toHaveBeenCalledTimes(2)
      await vm.refresh()
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it("keeps one visibility-aware clock until the last subscriber releases it", async () => {
    vi.useFakeTimers()
    mockListAgents.mockResolvedValue([])
    const vm = new ActiveAgents()
    const refreshMachine = vi.fn()
    const stopPanel = vm.subscribe(refreshMachine)
    const stopHeader = vm.subscribe()
    try {
      await vm.refresh()
      expect(mockListAgents).toHaveBeenCalledTimes(1)
      expect(refreshMachine).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)
      stopPanel()
      _setPageHiddenForTest(true)
      await vi.advanceTimersByTimeAsync(12_000)
      expect(mockListAgents).toHaveBeenCalledTimes(1)
      _setPageHiddenForTest(false)
      await vi.advanceTimersByTimeAsync(12_000)
      expect(mockListAgents).toHaveBeenCalledTimes(2)
      expect(refreshMachine).toHaveBeenCalledTimes(1)
    } finally {
      stopHeader()
      _setPageHiddenForTest(false)
      vi.useRealTimers()
    }
  })

  it("clears the timer and retries a failing request on remount", async () => {
    vi.useFakeTimers()
    const vm = new ActiveAgents()
    mockListAgents.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([])
    try {
      const stopFirst = vm.subscribe()
      await vm.refresh()
      expect(vm.hasSnapshot).toBe(false)
      stopFirst()
      expect(vi.getTimerCount()).toBe(0)

      const stopSecond = vm.subscribe()
      expect(mockListAgents).toHaveBeenCalledTimes(2)
      await vm.refresh()
      expect(vm.hasSnapshot).toBe(true)
      stopSecond()
      await vi.advanceTimersByTimeAsync(24_000)
      expect(mockListAgents).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("waits for a new list when a slow GET was captured before Kill", async () => {
    const stale = pendingList()
    const updated = pendingList()
    mockListAgents.mockReturnValueOnce(stale.promise).mockReturnValueOnce(updated.promise)
    mockDeleteAgent.mockResolvedValue(undefined)
    const vm = new ActiveAgents()
    const firstRead = vm.refresh()
    const killed = vi.fn()
    const mutation = vm.kill(fakeAgent.id).then(killed)
    await Promise.resolve()

    stale.resolve([fakeAgent])
    await firstRead
    expect(mockListAgents).toHaveBeenCalledTimes(2)
    expect(killed).not.toHaveBeenCalled()

    updated.resolve([])
    await mutation
    expect(vm.tree.roots).toEqual([])
  })

  it("does not let an intervening GET satisfy the later of two mutations", async () => {
    const stale = pendingList()
    const middle = pendingList()
    const final = pendingList()
    mockListAgents
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(middle.promise)
      .mockReturnValueOnce(final.promise)
    mockDeleteAgent.mockResolvedValue(undefined)
    mockSetAgentPersistent.mockResolvedValue(undefined)
    const vm = new ActiveAgents()
    const firstRead = vm.refresh()
    const killed = vm.kill("deleted")
    await Promise.resolve()
    stale.resolve([makeAgent({ id: "deleted" }), fakeAgent])
    await firstRead
    expect(mockListAgents).toHaveBeenCalledTimes(2)

    const finishedPin = vi.fn()
    const pinned = vm.setPersistent(fakeAgent.id, true).then(finishedPin)
    await Promise.resolve()
    middle.resolve([fakeAgent])
    await killed
    expect(mockListAgents).toHaveBeenCalledTimes(3)
    expect(finishedPin).not.toHaveBeenCalled()

    final.resolve([{ ...fakeAgent, persistent: true }])
    await pinned
    expect(vm.agents[0]?.persistent).toBe(true)
  })
})
