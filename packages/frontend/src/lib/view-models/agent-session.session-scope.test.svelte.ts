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
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

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
  session.sessionTitle = "first"
  session.titleManual = true
  session.userNotes = "note-a"
  session.sessionFields = { k: "v" }
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

/** Assert all nine session-scoped fields (§8.3) — use expect.soft so base runs report every leak. */
function expectSessionScopedDefaultsSoft(
  session: AgentSession,
  opts?: { sessionTitle?: string },
): void {
  expect.soft(session.sessionTitle).toBe(opts?.sessionTitle ?? "")
  expect.soft(session.titleManual).toBe(false)
  expect.soft(session.userNotes).toBe("")
  expect.soft(session.sessionFields).toEqual({})
  expect.soft(session.availableCommands).toEqual([])
  expect.soft(session.planStore).toEqual(EMPTY_PLAN_STORE)
  expect.soft(session.contextUsage).toBeNull()
  expect.soft(session.quota).toBeNull()
  expect.soft(session.quotaLoading).toBe(false)
}

function delay(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sseFetchFor(snapshot: unknown): ReturnType<typeof vi.fn> {
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
  })

  it("attachRemoteToLiveAgent applies manual title/notes/fields after enterSession", async () => {
    const snapshot = {
      ...createInitialSessionState({ sessionId: "live-scope-1" }),
      version: 3,
      messages: [],
    }
    vi.stubGlobal("fetch", sseFetchFor(snapshot))

    const agent = new AgentSession()
    await agent.attachRemoteToLiveAgent({
      transport: "http",
      agentId: "live-1",
      cwd: "/ws",
      cliKind: "claude",
      titleManual: true,
      title: "manual title",
      userNotes: "sticky notes",
      sessionFields: { env: "prod" },
    })
    await delay()

    expect(agent.sessionTitle).toBe("manual title")
    expect(agent.titleManual).toBe(true)
    expect(agent.userNotes).toBe("sticky notes")
    expect(agent.sessionFields).toEqual({ env: "prod" })
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
    expect.soft(session.userNotes).toBe("")
    expect.soft(session.sessionFields).toEqual({})
    expect.soft(session.availableCommands).toEqual([])
    expect.soft(session.planStore).toEqual(EMPTY_PLAN_STORE)
    expect.soft(session.contextUsage).toBeNull()
    expect.soft(session.quota).toBeNull()
    expect.soft(session.quotaLoading).toBe(false)
    expect.soft(session.sessionTitle).toBe("🧪 greeting")
  })
})
