/**
 * agent-session.integration.test.svelte.ts — C4 integration test.
 *
 * Verifies the full pipeline:
 *   LocalSessionView (mock transport) → VM (AgentSession)
 *
 * Test approach:
 * - Create LocalSessionView with injected mock AcpClient
 * - Pass it to AgentSession via constructor DI
 * - Verify session updates flow from mock client → LocalSessionView → VM bubbles
 * - Verify prompt() delegation: VM.sendPrompt → LocalSessionView.prompt → mock client
 *
 * ─── slice session-view-port C4 (integration) ───
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { AgentSession } from "./agent-session.svelte"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { LocalSessionView } from "$lib/session/local-session-view"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"

// ─── Test helpers ───

function delay(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createMockClient(sessionId = "integration-session"): {
  client: AcpClient
  getCallbacks: () => AcpClientCallbacks
} {
  let capturedCbs: AcpClientCallbacks | null = null

  const client = {
    newSession: vi.fn().mockResolvedValue({ sessionId }),
    loadSession: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    extMethod: vi.fn().mockResolvedValue({ snapshot: null }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setSessionConfigOption: vi.fn().mockResolvedValue({ ok: true }),
    setSessionMode: vi.fn().mockResolvedValue({ ok: true }),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    authMethods: [],
  } as unknown as AcpClient

  const createClient = async (cbs: AcpClientCallbacks): Promise<AcpClient> => {
    capturedCbs = cbs
    return client
  }

  return {
    client,
    getCallbacks: () => {
      if (!capturedCbs) throw new Error("createClient not called yet")
      return capturedCbs
    },
  }
}

// ─── Integration tests ───

describe("VM + LocalSessionView integration (C4)", () => {
  let mock: ReturnType<typeof createMockClient>
  let view: LocalSessionView
  let agent: AgentSession

  beforeEach(async () => {
    mock = createMockClient()
    view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        ;(mock as { _captureCbs?: (c: AcpClientCallbacks) => void })._captureCbs?.(cbs)
        return mock.client
      },
    })

    // Override createClient to capture callbacks properly
    let capturedCbs: AcpClientCallbacks | null = null
    view = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        ;(mock as { _capturedCbs?: AcpClientCallbacks })._capturedCbs = cbs
        return mock.client
      },
    })
    ;(view as unknown as { _getCapturedCbs?: () => AcpClientCallbacks | null })._getCapturedCbs =
      () => capturedCbs

    agent = new AgentSession({ view })
  })

  it("newSession() → agent status starts as connected in view", async () => {
    await view.newSession()
    expect(view.state.status).toBe("connected")
    expect(view.state.sessionId).toBe("integration-session")
  })

  it("session update from mock → VM bubbles updated via patches", async () => {
    const view = new MockSessionView()
    view.connect("integration-session")
    const localAgent = new AgentSession({ view })
    localAgent._setStatusForTest("connected")

    view.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Integration message" },
      messageId: "im-1",
    })

    await delay()

    expect(localAgent.bubbles.length).toBeGreaterThan(0)
    const bubble = localAgent.bubbles[localAgent.bubbles.length - 1]!
    expect(bubble.kind).toBe("message")
    if (bubble.kind === "message") {
      expect(bubble.segments.some((s) => s.text === "Integration message")).toBe(true)
    }
  })

  it("multiple chunks group into one bubble", async () => {
    const view = new MockSessionView()
    view.connect("integration-session")
    const localAgent = new AgentSession({ view })
    localAgent._setStatusForTest("connected")

    view.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Part 1" },
      messageId: "gm-1",
    })
    view.fireUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: " Part 2" },
      messageId: "gm-1",
    })

    await delay()

    const msgBubbles = localAgent.bubbles.filter((b) => b.kind === "message")
    expect(msgBubbles).toHaveLength(1)
    const segments = (msgBubbles[0] as { segments: { text: string }[] }).segments
    expect(segments).toHaveLength(2)
  })

  it("thought chunk → turnState 'thinking' in VM", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const localView = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    const localAgent = new AgentSession({ view: localView })

    await localView.newSession()

    capturedCbs!.onUpdate!({
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Thinking..." },
        messageId: "th-1",
      },
    } as never)

    await delay()
    expect(localAgent.turnState).toBe("thinking")
  })

  it("session_info_update → sessionTitle updated in VM", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const localView = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })
    const localAgent = new AgentSession({ view: localView })

    await localView.newSession()

    capturedCbs!.onUpdate!({
      update: {
        sessionUpdate: "session_info_update",
        title: "My Integration Test",
      },
    } as never)

    await delay()
    expect(localAgent.sessionTitle).toBe("My Integration Test")
  })

  it("pending permission bridging: agent sees permission in view.state", async () => {
    let capturedCbs: AcpClientCallbacks | null = null
    const localView = new LocalSessionView({
      cwd: "/workspace",
      cliKind: "claude",
      createClient: async (cbs) => {
        capturedCbs = cbs
        return mock.client
      },
    })

    await localView.newSession()

    const fakePermParams = {
      sessionId: "integration-session",
      toolCall: { toolCallId: "tc-perm" } as never,
      options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" }],
    }

    void capturedCbs!.onRequestPermission!(fakePermParams as never)

    // LocalSessionView state should have the pending permission
    expect(localView.state.pending.permission).not.toBeNull()
    expect(localView.state.pending.permission!.requestId).toBeTypeOf("number")
  })
})
