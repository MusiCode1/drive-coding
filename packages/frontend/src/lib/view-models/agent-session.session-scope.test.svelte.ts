/**
 * agent-session.session-scope.test.svelte.ts — session identity boundary (slice session-scope-migration).
 * @vitest-environment jsdom
 */

import type { AvailableCommand } from "@agentclientprotocol/sdk"
import { EMPTY_PLAN_STORE } from "@drive-coding/core/acp/plan"
import { createInitialSessionState } from "@drive-coding/core/session"
import { toWireText } from "@drive-coding/core/session/testing"
import { flushSync } from "svelte"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { patchAgent } from "$lib/adapters/agents-api"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"
import { SessionMemoVM } from "./session-memo.svelte"

function connectedSession(sessionId: string): AgentSession {
  const view = new MockSessionView()
  view.connect(sessionId)
  view.loadSessionMock.mockImplementation(async (nextId: string) => view.connect(nextId))
  const session = new AgentSession({ view })
  session._setStatusForTest("connected")
  session._setSessionContextForTest({ sessionId, cwd: "/proj", cliKind: "opencode" })
  return session
}

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "scope-test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

function mountMemo(session: AgentSession) {
  const result: { memo?: SessionMemoVM } = {}
  const stop = $effect.root(() => {
    result.memo = new SessionMemoVM(session)
  })
  flushSync()
  if (!result.memo) throw new Error("Could not mount session memo")
  return { memo: result.memo, stop }
}

const mockFixture = {
  updates: [
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "mock replay" },
      messageId: "m1",
    },
  ],
}

function seedSessionA(session: AgentSession): void {
  session.agentId = "scope-test-agent"
  session.sessionTitle = "first"
  session.titleManual = true
  session.agentNotes = "note-a"
  session.agentFields = { k: "v" }
  session.availableCommands = [
    { name: "do", description: "x", input: { hint: "" } },
  ] as AvailableCommand[]
  session.planStore = {
    order: ["__default__"],
    byId: { __default__: { kind: "entries", entries: [{ content: "step", status: "pending" }] } },
  }
  session.contextUsage = {
    usedTokens: 1,
    maxTokens: 100,
  } as unknown as AgentSession["contextUsage"]
  session.quota = { provider: "test", windows: [] }
  session.quotaLoading = true
}

/** Assert session-scoped fields (§8.3) — use expect.soft so base runs report every leak. */
function expectSessionScopedDefaultsSoft(
  session: AgentSession,
  opts?: { sessionTitle?: string },
): void {
  expect.soft(session.sessionTitle).toBe(opts?.sessionTitle ?? "")
  expect.soft(session.titleManual).toBe(false)
  expect.soft(session.availableCommands).toEqual([])
  expect.soft(session.planStore).toEqual(EMPTY_PLAN_STORE)
  expect.soft(session.contextUsage).toBeNull()
  expect.soft(session.quota).toBeNull()
  expect.soft(session.quotaLoading).toBe(false)
}

function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sseFetchFor(snapshot: unknown) {
  const encoder = new TextEncoder()
  const sseText = toWireText([{ event: "snapshot", data: JSON.stringify(snapshot) }])
  return vi.fn(async (url: string) => {
    if (String(url).includes("/events")) {
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(encoder.encode(sseText))
        },
      })
      return { ok: true, status: 200, body } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response
  })
}

describe("AgentSession session-scope boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockFixture),
      }),
    )
  })

  it("different sessionId without title resets session-scoped fields (bug #71)", async () => {
    const session = connectedSession("sess-a")
    await session.switchSession({
      sessionId: "sess-1",
      cwd: "/proj",
      cliKind: "opencode",
      title: "first",
    })
    seedSessionA(session)
    expect(session.sessionTitle).toBe("first")

    await session.switchSession({ sessionId: "sess-2", cwd: "/proj", cliKind: "opencode" })

    expectSessionScopedDefaultsSoft(session)
    expect(session.agentNotes).toBe("note-a")
    expect(session.agentFields).toEqual({ k: "v" })
  })

  it("switching to the same session preserves its title", async () => {
    const session = connectedSession("sess-a")
    await session.switchSession({
      sessionId: "sess-1",
      cwd: "/proj",
      cliKind: "opencode",
      title: "kept",
    })
    await session.switchSession({ sessionId: "sess-1", cwd: "/proj", cliKind: "opencode" })
    expect(session.sessionTitle).toBe("kept")
    session.agentId = "scope-test-agent"
    await session.switchSession({
      sessionId: "sess-2",
      cwd: "/proj",
      cliKind: "opencode",
      title: "sync",
    })
    expect(patchAgent).toHaveBeenCalledExactlyOnceWith("scope-test-agent", { title: "sync" })
    session.titleManual = true
    await session.switchSession({
      sessionId: "sess-2",
      cwd: "/proj",
      cliKind: "opencode",
      title: "ignore",
    })
    expect(session.sessionTitle).toBe("sync")
    expect(patchAgent).toHaveBeenCalledTimes(1)
  })

  it("attachRemoteToLiveAgent applies manual title/notes/fields after enterSession", async () => {
    const snapshot = {
      ...createInitialSessionState({ sessionId: "live-scope-1" }),
      version: 3,
      messages: [],
    }
    vi.stubGlobal("fetch", sseFetchFor(snapshot))

    const agent = new AgentSession()
    const { memo, stop } = mountMemo(agent)
    let accept!: (response: Response) => void
    const deferred = new Promise<Response>((resolve) => {
      accept = resolve
    })
    const fetchSnapshot = sseFetchFor(snapshot)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/events")) return deferred
        return fetchSnapshot(url)
      }),
    )
    try {
      const attaching = agent.attachRemoteToLiveAgent({
        transport: "http",
        agentId: "live-1",
        cwd: "/ws",
        cliKind: "claude",
        titleManual: true,
        title: "manual title",
        agentNotes: "sticky notes",
        agentFields: { env: "fixture" },
      })
      flushSync()
      expect(agent.agentId).toBe("live-1")
      await delay(320)
      expect(memo.text).toBe("")
      expect(patchAgent).not.toHaveBeenCalled()
      accept(await fetchSnapshot("/events"))
      await attaching
      flushSync()

      expect(agent.sessionTitle).toBe("manual title")
      expect(agent.titleManual).toBe(true)
      expect(agent.agentNotes).toBe("sticky notes")
      expect(agent.agentFields).toEqual({ env: "fixture" })
      expect(memo.text).toBe("sticky notes")
      expect(patchAgent).not.toHaveBeenCalled()
      agent.detach()
      flushSync()
      expect(agent.agentNotes).toBe("")
      expect(agent.agentFields).toEqual({})
      expect(memo.text).toBe("")

      vi.stubGlobal("fetch", sseFetchFor(snapshot))
      await agent.attachRemoteToLiveAgent({
        transport: "http",
        agentId: "live-2",
        cwd: "/ws",
        cliKind: "claude",
        agentNotes: "other",
        agentFields: { phase: "second" },
      })
      flushSync()
      expect(memo.text).toBe("other")
      expect(agent.agentFields).toEqual({ phase: "second" })
      expect(patchAgent).not.toHaveBeenCalled()
    } finally {
      agent.detach()
      stop()
    }
  })

  it("memo reads reactive ACP session identity through switchSession and newSession", async () => {
    const session = connectedSession("sess-a")
    seedSessionA(session)
    const prefs = new Map([
      ["dc:session-memo:sess-a", '{"minimized":false}'],
      ["dc:session-memo:remote-new-sess", '{"minimized":false}'],
    ])
    vi.stubGlobal("localStorage", { getItem: (key: string) => prefs.get(key) ?? null })
    const { memo, stop } = mountMemo(session)
    try {
      expect(memo.minimized).toBe(false)
      expect(memo.text).toBe("note-a")
      await session.switchSession({ sessionId: "sess-b", cwd: "/proj", cliKind: "opencode" })
      flushSync()
      expect(memo.minimized).toBe(true)
      expect(memo.text).toBe("note-a")
      expect(session.agentFields).toEqual({ k: "v" })
      expectSessionScopedDefaultsSoft(session)
      await session.newSession({ cwd: "/proj", cliKind: "opencode" })
      flushSync()
      expect(session.sessionId).toBe("remote-new-sess")
      expect(session.status).toBe("connected")
      expect(memo.minimized).toBe(false)
      expect(memo.text).toBe("note-a")
      expect(session.agentFields).toEqual({ k: "v" })
      expect(patchAgent).not.toHaveBeenCalled()
    } finally {
      stop()
      vi.unstubAllGlobals()
    }
  })

  it("reactivity: $effect sees title across session identity changes", async () => {
    const session = connectedSession("sess-a")
    const seen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(session.sessionTitle)
      })
    })

    await session.switchSession({
      sessionId: "sess-a",
      cwd: "/p",
      cliKind: "opencode",
      title: "A",
    })
    flushSync()

    await session.switchSession({ sessionId: "sess-b", cwd: "/p", cliKind: "opencode" })
    flushSync()
    session.sessionTitle = "B"
    flushSync()
    stop()

    expect(seen).toEqual(["", "A", "", "B"])
  })

  it("attachRemote sets sessionId from remote snapshot (enterSession site)", async () => {
    const snapshot = createInitialSessionState({ sessionId: "remote-enter-1" })
    vi.stubGlobal("fetch", sseFetchFor(snapshot))

    const agent = new AgentSession()
    await agent.attachRemote({ cwd: "/ws", cliKind: "claude", transport: "http" })
    await delay()

    expect(agent._sessionIdForTest()).toBe("remote-enter-1")
    expect(agent.status).toBe("connected")
  })

  it("switchSession (remote) resets scoped fields on session identity change (§4.2א #6)", async () => {
    const view = new MockSessionView()
    view.connect("sess-a")
    // SessionState carries no cwd — only the session identity changes here.
    view.loadSessionMock.mockImplementation(async (sessionId: string) => {
      view.state = { ...view.state, sessionId }
    })

    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")
    agent._setSessionContextForTest({ sessionId: "sess-a", cwd: "/proj", cliKind: "claude" })
    seedSessionA(agent)

    await agent.switchSession({ sessionId: "sess-b", cwd: "/proj", cliKind: "claude" })

    expectSessionScopedDefaultsSoft(agent)
  })

  it("#loadMockSession path resets scoped fields on mock identity change (§4.2א #10)", async () => {
    const session = connectedSession("sess-a")
    await session.switchSession({
      sessionId: "sess-a",
      cwd: "/proj",
      cliKind: "opencode",
      title: "first",
    })
    seedSessionA(session)

    session._setStatusForTest("disconnected")
    await session.openMockSession("greeting", "/proj")

    expect.soft(session.titleManual).toBe(false)
    expect.soft(session.agentNotes).toBe("")
    expect.soft(session.agentFields).toEqual({})
    expect.soft(session.availableCommands).toEqual([])
    expect.soft(session.planStore).toEqual(EMPTY_PLAN_STORE)
    expect.soft(session.contextUsage).toBeNull()
    expect.soft(session.quota).toBeNull()
    expect.soft(session.quotaLoading).toBe(false)
    expect.soft(session.sessionTitle).toBe("🧪 greeting")
  })
})
