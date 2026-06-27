/**
 * agent-session.test.ts — structural tests for AgentSession.#appendChunk grouping logic.
 *
 * Runs in Node environment (vitest environment: node). The `#appendChunk` method is
 * private; we test it indirectly by capturing the `#onSessionUpdate` callback passed
 * to `createAcpClient`, then invoking it with synthetic SessionNotification objects.
 *
 * Test scenarios (from brief §4):
 *   - agent_message_chunk with messageId="abc" × 3 → 1 bubble with 3 segments
 *   - agent_message_chunk with messageId=null × 3 → 1 bubble with 3 segments
 *   - agent_thought_chunk with messageId=null × 2 → 1 bubble with 2 segments
 *   - msg→thought→msg (all null) → 3 bubbles (kind alternates)
 *   - null msg → null user → 2 bubbles (kind changes)
 *   - user with messageId="x" × 2 → 1 bubble with 2 segments (existing behavior preserved)
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AcpClient } from "@drive-coding/provider/client"
import type { Bubble, MessageBubble, ThoughtBubble, UserBubble } from "$lib/types/bubble"

// ─── Module-level mocks ───────────────────────────────────────────────────────

/** Captured callback from createAcpClient — invoked in tests to simulate updates. */
let onSessionUpdate: ((notification: unknown) => void) | null = null

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      callback: (notification: unknown) => void,
    ): Promise<AcpClient> {
      onSessionUpdate = callback
      return Promise.resolve({
        newSession: vi.fn().mockResolvedValue({ sessionId: "test-session" }),
        prompt: vi.fn().mockResolvedValue(undefined),
        loadSession: vi.fn().mockResolvedValue({}),
        cancel: vi.fn(),
        listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
        close: vi.fn(),
        setSessionConfigOption: vi.fn(),
        setSessionModel: vi.fn(),
        setSessionMode: vi.fn(),
      } as unknown as AcpClient)
    }),
  }
})

vi.mock("@drive-coding/provider/transport/ws", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "test-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AgentSession } from "./agent-session.svelte"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * יוצר SessionNotification-workaround עבור agent_message_chunk.
 * המבנה המדויק תלוי במה ש-#onSessionUpdate מצפה לו: `{ update: { sessionUpdate, content, messageId } }`.
 */
function msgChunk(text: string, messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      messageId,
    },
  }
}

function thoughtChunk(text: string, messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text },
      messageId,
    },
  }
}

function userChunk(text: string, messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text },
      messageId,
    },
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("AgentSession bubble grouping (#appendChunk via #onSessionUpdate)", () => {
  let session: AgentSession

  beforeEach(async () => {
    vi.clearAllMocks()
    onSessionUpdate = null

    // stub location for attach() — it reads location.protocol + location.host
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })

    session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
  })

  it("Claude-style: 3 agent_message_chunk with same messageId → 1 bubble with 3 segments", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate!(msgChunk("hello", "abc"))
    onSessionUpdate!(msgChunk(" world", "abc"))
    onSessionUpdate!(msgChunk("!", "abc"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as MessageBubble
    expect(bubble.kind).toBe("message")
    expect(bubble.messageId).toBe("abc")
    expect(bubble.segments.map((s) => s.text).join("")).toBe("hello world!")
  })

  it("Gemini-style: 3 agent_message_chunk with null messageId → 1 bubble with 3 segments", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate!(msgChunk("hello", null))
    onSessionUpdate!(msgChunk(" world", null))
    onSessionUpdate!(msgChunk("!", null))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as MessageBubble
    expect(bubble.kind).toBe("message")
    expect(bubble.messageId).toBeNull()
    expect(bubble.segments.map((s) => s.text).join("")).toBe("hello world!")
  })

  it("Gemini-style: 2 agent_thought_chunk with null messageId → 1 bubble with 2 segments", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate!(thoughtChunk("step 1", null))
    onSessionUpdate!(thoughtChunk(" step 2", null))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as ThoughtBubble
    expect(bubble.kind).toBe("thought")
    expect(bubble.segments.map((s) => s.text).join("")).toBe("step 1 step 2")
  })

  it("msg → thought → msg (all null) → 3 bubbles (kind alternates)", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate!(msgChunk("hello", null))
    onSessionUpdate!(thoughtChunk("thinking", null))
    onSessionUpdate!(msgChunk(" world", null))

    expect(session.bubbles).toHaveLength(3)
    expect(session.bubbles[0]!.kind).toBe("message")
    expect(session.bubbles[1]!.kind).toBe("thought")
    expect(session.bubbles[2]!.kind).toBe("message")
    expect((session.bubbles[0] as MessageBubble).segments.map((s) => s.text).join("")).toBe("hello")
    expect((session.bubbles[1] as ThoughtBubble).segments.map((s) => s.text).join("")).toBe("thinking")
    expect((session.bubbles[2] as MessageBubble).segments.map((s) => s.text).join("")).toBe(" world")
  })

  it("null msg → null user → 2 bubbles (kind changes)", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate!(msgChunk("hello", null))
    onSessionUpdate!(userChunk("user text", null))

    expect(session.bubbles).toHaveLength(2)
    expect(session.bubbles[0]!.kind).toBe("message")
    expect(session.bubbles[1]!.kind).toBe("user")
  })

  it("user_message_chunk with same messageId → 1 bubble with 2 segments (existing behavior)", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate!(userChunk("first", "x"))
    onSessionUpdate!(userChunk(" second", "x"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.kind).toBe("user")
    expect(bubble.segments.map((s) => s.text).join("")).toBe("first second")
  })
})

// ─── Integration: newSession (warm new-session) ────────────────────────────────

describe("AgentSession.newSession", () => {
  let session: AgentSession

  beforeEach(async () => {
    vi.clearAllMocks()
    onSessionUpdate = null
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
    session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
  })

  it("warm path: calls #client.newSession, clears bubbles, updates sessionId via ACP response", async () => {
    const { createAcpClient } = await import("@drive-coding/provider/client")
    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<typeof createAcpClient>)
    // הוסף בועה קיימת כדי לאמת שהיא נמחקת
    session.bubbles = [{ id: "old", kind: "user", messageId: null, createdAt: 0, segments: [] }]

    await session.newSession({ cliKind: "opencode" })

    expect(mockClient.newSession).toHaveBeenCalledWith({ cwd: "/tmp" })
    expect(session.bubbles).toHaveLength(0)
    expect(session.status).toBe("connected")
  })

  it("calls notifySessionAttached with replace:true", async () => {
    const { notifySessionAttached } = await import("$lib/adapters/agents-api")

    await session.newSession({ cliKind: "opencode" })

    expect(notifySessionAttached).toHaveBeenCalledWith(
      "test-agent",
      "test-session",
      { replace: true },
    )
  })

  it("fallback: #client===null (no prior attach) → calls attach", async () => {
    const freshSession = new AgentSession()
    // לא עשינו attach — #client===null
    const attachSpy = vi.spyOn(freshSession, "attach")
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })

    await freshSession.newSession({ cwd: "/fallback", cliKind: "opencode" })

    expect(attachSpy).toHaveBeenCalledWith({ cwd: "/fallback", cliKind: "opencode" })
  })

  it("throws when status !== connected (guard backstop)", async () => {
    // סמלץ status connecting — בלי לשלוח פרומפט אמיתי (thinking הוסר מ-AgentSessionStatus ב-msr-v2)
    session.status = "connecting" as typeof session.status

    await expect(session.newSession({ cliKind: "opencode" })).rejects.toThrow(
      "cannot newSession in status connecting",
    )
  })
})

// ─── TDD: claude-thinking-meta — #sessionMeta + _meta injection ──────────────

const EXPECTED_META = {
  claudeCode: { options: { thinking: { type: "adaptive", display: "summarized" } } },
}

describe("AgentSession._meta injection (claude-thinking-meta)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
  })

  // ── attach (newSession) with claude → _meta injected ──
  it("attach with cliKind=claude → newSession called with _meta.claudeCode.options.thinking", async () => {
    const { createAcpClient } = await import("@drive-coding/provider/client")
    const session = new AgentSession()
    await session.attach({ cwd: "/proj", cliKind: "claude" })

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<typeof createAcpClient>)
    expect(mockClient.newSession).toHaveBeenCalledWith({
      cwd: "/proj",
      _meta: EXPECTED_META,
    })
  })

  // ── attach with opencode → NO _meta (backward-compat) ──
  it("attach with cliKind=opencode → newSession called WITHOUT _meta", async () => {
    const { createAcpClient } = await import("@drive-coding/provider/client")
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<typeof createAcpClient>)
    expect(mockClient.newSession).toHaveBeenCalledWith({ cwd: "/tmp" })
  })

  // ── loadSession (cold) with claude → _meta injected ──
  it("loadSession with claude → loadSession called with _meta", async () => {
    const { createAcpClient } = await import("@drive-coding/provider/client")
    const session = new AgentSession()
    await session.loadSession({ sessionId: "sess-1", cwd: "/proj", cliKind: "claude" })

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<typeof createAcpClient>)
    expect(mockClient.loadSession).toHaveBeenCalledWith({
      sessionId: "sess-1",
      cwd: "/proj",
      _meta: EXPECTED_META,
    })
  })

  // ── loadSession with opencode → NO _meta ──
  it("loadSession with opencode → loadSession called WITHOUT _meta", async () => {
    const { createAcpClient } = await import("@drive-coding/provider/client")
    const session = new AgentSession()
    await session.loadSession({ sessionId: "sess-2", cwd: "/tmp", cliKind: "opencode" })

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<typeof createAcpClient>)
    expect(mockClient.loadSession).toHaveBeenCalledWith({ sessionId: "sess-2", cwd: "/tmp" })
  })
})

// ─── TDD: slice-session-title-header — sessionTitle state ────────────────────

describe("AgentSession.sessionTitle (slice-session-title-header)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
  })

  it("loadSession with title sets sessionTitle", async () => {
    const session = new AgentSession()
    await session.loadSession({ sessionId: "sess-1", cwd: "/proj", cliKind: "opencode", title: "פיקדון" })

    expect(session.sessionTitle).toBe("פיקדון")
  })

  it("keep-on-undefined: loadSession without title preserves existing sessionTitle", async () => {
    const session = new AgentSession()
    // קודם: קבע title
    await session.loadSession({ sessionId: "sess-1", cwd: "/proj", cliKind: "opencode", title: "פיקדון" })
    expect(session.sessionTitle).toBe("פיקדון")

    // סמלץ #coldReconnect — מאפס status ל-disconnected ומריץ loadSession בלי title
    session.status = "disconnected" as typeof session.status
    await session.loadSession({ sessionId: "sess-1", cwd: "/proj", cliKind: "opencode" })
    expect(session.sessionTitle).toBe("פיקדון")
  })

  it("newSession resets sessionTitle to empty string", async () => {
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
    // סמלץ title קיים
    session.sessionTitle = "ישן"
    await session.newSession({ cliKind: "opencode" })
    expect(session.sessionTitle).toBe("")
  })
})
