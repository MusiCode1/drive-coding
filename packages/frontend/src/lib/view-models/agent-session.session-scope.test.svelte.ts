/**
 * agent-session.session-scope.test.svelte.ts — session identity boundary (slice session-scope-migration).
 * @vitest-environment jsdom
 */

import { createInitialSessionState } from "@drive-coding/core/session"
import { toWireText } from "@drive-coding/core/session/testing"
import type { AcpClient } from "@drive-coding/provider/client"
import { flushSync } from "svelte"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AgentSession } from "./agent-session.svelte"

let loadSessionMock = vi.fn().mockResolvedValue({})

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(async () => ({
      newSession: vi.fn().mockResolvedValue({ sessionId: "test-session" }),
      loadSession: (...args: unknown[]) => loadSessionMock(...args),
      prompt: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
      close: vi.fn(),
      setSessionConfigOption: vi.fn(),
      setSessionModel: vi.fn(),
      setSessionMode: vi.fn(),
      conn: {} as AcpClient["conn"],
      capabilities: {} as AcpClient["capabilities"],
      authMethods: [],
    })),
  }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "scope-test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

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
    loadSessionMock = vi.fn().mockResolvedValue({})
  })

  it("different sessionId without title resets session-scoped fields (bug #71)", async () => {
    const session = new AgentSession()
    await session.loadSession({
      sessionId: "sess-1",
      cwd: "/proj",
      cliKind: "opencode",
      title: "first",
    })
    session.titleManual = true
    session.userNotes = "note-a"
    session.sessionFields = { k: "v" }
    expect(session.sessionTitle).toBe("first")
    expect(session.titleManual).toBe(true)
    expect(session.userNotes).toBe("note-a")
    expect(session.sessionFields).toEqual({ k: "v" })

    session.status = "disconnected" as typeof session.status
    await session.loadSession({ sessionId: "sess-2", cwd: "/proj", cliKind: "opencode" })

    expect(session.sessionTitle).toBe("")
    expect(session.titleManual).toBe(false)
    expect(session.userNotes).toBe("")
    expect(session.sessionFields).toEqual({})
    expect(session.availableCommands).toEqual([])
    expect(session.planStore.order).toEqual([])
    expect(session.contextUsage).toBeNull()
    expect(session.quota).toBeNull()
    expect(session.quotaLoading).toBe(false)
  })

  it("same sessionId preserves sessionTitle on cold reload", async () => {
    const session = new AgentSession()
    await session.loadSession({
      sessionId: "sess-1",
      cwd: "/proj",
      cliKind: "opencode",
      title: "kept",
    })
    session.status = "disconnected" as typeof session.status
    await session.loadSession({ sessionId: "sess-1", cwd: "/proj", cliKind: "opencode" })
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
    const session = new AgentSession()
    const seen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(session.sessionTitle)
      })
    })

    await session.loadSession({
      sessionId: "sess-a",
      cwd: "/p",
      cliKind: "opencode",
      title: "A",
    })
    flushSync()

    session.status = "disconnected" as typeof session.status
    await session.loadSession({ sessionId: "sess-b", cwd: "/p", cliKind: "opencode" })
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
    await agent.attachRemote({ cwd: "/ws", cliKind: "claude" })
    await delay()

    expect(agent._sessionIdForTest()).toBe("remote-enter-1")
    expect(agent.status).toBe("connected")
  })
})
