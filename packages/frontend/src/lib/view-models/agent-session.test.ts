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

import type { AcpClient } from "@drive-coding/provider/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageBubble, ThoughtBubble, ToolBubble, UserBubble } from "$lib/types/bubble"

// ─── Module-level mocks ───────────────────────────────────────────────────────
import { stableBubbleKey } from "$lib/util/bubble-key"

let onSessionUpdate: ((notification: unknown) => void) | null = null

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(function mockCreateClient(
      _transport: unknown,
      callbackOrCallbacks:
        | ((notification: unknown) => void)
        | { onUpdate: (n: unknown) => void; onExtNotification?: unknown },
    ): Promise<AcpClient> {
      // ─── slice FE-normalization: תמיכה בשתי חתימות ───
      onSessionUpdate =
        typeof callbackOrCallbacks === "function"
          ? callbackOrCallbacks
          : callbackOrCallbacks.onUpdate
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

vi.mock("$lib/engines/ws-transport", () => ({
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

function toolCall(id: string, title: string): unknown {
  return {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: id,
      title,
      kind: "read",
      status: "pending",
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
    expect((session.bubbles[1] as ThoughtBubble).segments.map((s) => s.text).join("")).toBe(
      "thinking",
    )
    expect((session.bubbles[2] as MessageBubble).segments.map((s) => s.text).join("")).toBe(
      " world",
    )
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

  it("019fed5d scenario: interleaved chunks with same messageId → zero duplicate keys in stableBubbleKey", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate?.(msgChunk("part 1", "msg-019fed5d"))
    onSessionUpdate?.(thoughtChunk("thinking...", "msg-019fed5d"))
    onSessionUpdate?.(msgChunk("part 2", "msg-019fed5d"))

    expect(session.bubbles).toHaveLength(3)
    const list = session.renderBubbles
    const keys = list.map((b) => stableBubbleKey(b, list))
    const uniqueKeys = new Set(keys)
    expect(keys.length).toBe(3)
    expect(uniqueKeys.size).toBe(3)
    expect(keys).toEqual([
      "message:m:msg-019fed5d",
      "thought:m:msg-019fed5d",
      "message:m:msg-019fed5d:n2",
    ])
  })

  it("message → tool → message with same messageId → second message gets :n2", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate?.(msgChunk("before tool", "m1"))
    // ⚠️ מיזוג dev → שרשרת: הגרסה של dev דחפה בועת-כלי ידנית ל-session.bubbles.
    // בשרשרת המצב מונע מ-core, ודחיפה ידנית עוקפת אותו — canGroupWith היה רואה
    // את הודעת "before tool" כאחרונה ומקבץ, כלומר הטסט בדק את ה-harness ולא
    // את הקוד. כאן הכלי עובר במסלול האמיתי, בדיוק כמו בייצור.
    onSessionUpdate?.(toolCall("call-1", "read"))
    onSessionUpdate?.(msgChunk("after tool", "m1"))

    const list = session.renderBubbles
    expect(list).toHaveLength(3)
    expect(list.map((b) => stableBubbleKey(b, list))).toEqual([
      "message:m:m1",
      "tool:t:call-1",
      "message:m:m1:n2",
    ])
  })

  it("second tool_call with the same toolCallId updates the existing bubble (no duplicate key)", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate?.(toolCall("call-1", "Read"))
    onSessionUpdate?.(toolCall("call-1", "Read file"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as ToolBubble
    expect(bubble.kind).toBe("tool")
    expect(bubble.toolCall.toolCallId).toBe("call-1")
    expect(bubble.toolCall.title).toBe("Read file")
    const list = session.renderBubbles
    const keys = list.map((b) => stableBubbleKey(b, list))
    expect(new Set(keys).size).toBe(keys.length)
  })

  // ⚠️ מיזוג dev → שרשרת ה-HTTP — הטסט שוכתב, והכוונה נשמרה.
  //
  // dev בדק: בועה אופטימית שנדחפה ידנית + user_message_chunk ⇒ בועה אחת.
  // זה היה נכון לארכיטקטורה שלו, שבה שתיהן חיו באותו מערך (#appendChunk).
  // בשרשרת הבועה האופטימית היא FE-בלבד ו-core אינו יודע עליה, ולכן ההנחה
  // אינה מתקיימת — וגם **אינה נדרשת**: נמדד על 201 הקלטות ש-user_message_chunk
  // מגיע **רק ב-replay של session/load**, אף פעם לא בתור חי. ב-replay מגיע
  // patch מסוג reset שבונה את הבועות מחדש מ-core, כך שאין כפילות.
  //
  // מה שנשמר כאן הוא מה ש-dev באמת הגן עליו: **אין מפתחות כפולים**.
  it("user_message_chunk chunks with the same messageId group into one bubble (no duplicate keys)", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate?.(userChunk("my ", "acp-msg-1"))
    onSessionUpdate?.(userChunk("prompt", "acp-msg-1"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.messageId).toBe("acp-msg-1")
    expect(bubble.segments).toHaveLength(2)

    const list = session.renderBubbles
    const keys = list.map((b) => stableBubbleKey(b, list))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("standalone whitespace-only chunks (\n) do not create empty message bubbles when canGroup is false", () => {
    expect(onSessionUpdate).not.toBeNull()
    onSessionUpdate?.(msgChunk("hello", "m1"))
    // Simulate tool call inserting a non-groupable bubble
    session.bubbles.push({
      id: "t1",
      kind: "tool",
      messageId: null,
      createdAt: Date.now(),
      segments: [],
      toolCall: { toolCallId: "call-1", name: "read", args: undefined, status: "completed" },
    })

    // Standalone newline chunk after tool call
    onSessionUpdate?.(msgChunk("\n", "m1"))

    // Should NOT create a 3rd bubble just for "\n"
    expect(session.bubbles).toHaveLength(2)
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
    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<
      typeof createAcpClient
    >)
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

    expect(notifySessionAttached).toHaveBeenCalledWith("test-agent", "test-session", {
      replace: true,
    })
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
  claudeCode: {
    options: {
      thinking: { type: "adaptive", display: "summarized" },
      forwardSubagentText: true,
    },
    emitRawSDKMessages: [
      { type: "system", subtype: "task_started" },
      { type: "system", subtype: "task_progress" },
      { type: "system", subtype: "task_notification" },
      { type: "system", subtype: "task_updated" },
      { type: "assistant" },
      // slice subagent-transcript-data-v2 Commit 0: בלי זה, tool_result של תת-הסוכן לא זורם.
      { type: "user" },
    ],
  },
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

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<
      typeof createAcpClient
    >)
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

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<
      typeof createAcpClient
    >)
    expect(mockClient.newSession).toHaveBeenCalledWith({ cwd: "/tmp" })
  })

  // ── loadSession (cold) with claude → _meta injected ──
  it("loadSession with claude → loadSession called with _meta", async () => {
    const { createAcpClient } = await import("@drive-coding/provider/client")
    const session = new AgentSession()
    await session.loadSession({ sessionId: "sess-1", cwd: "/proj", cliKind: "claude" })

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<
      typeof createAcpClient
    >)
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

    const mockClient = await (vi.mocked(createAcpClient).mock.results[0]?.value as ReturnType<
      typeof createAcpClient
    >)
    expect(mockClient.loadSession).toHaveBeenCalledWith({ sessionId: "sess-2", cwd: "/tmp" })
  })
})

// ─── slice project-system-prompt Commit 2 — attach forwards systemPrompt to createAgent ───

describe("AgentSession.attach — systemPrompt forwarded to createAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
  })

  it("attach({ systemPrompt }) → createAgent called with systemPrompt", async () => {
    const { createAgent } = await import("$lib/adapters/agents-api")
    const session = new AgentSession()
    await session.attach({
      cwd: "/proj",
      cliKind: "claude",
      systemPrompt: "Always end every reply with QAZ",
    })

    expect(createAgent).toHaveBeenCalledWith({
      cwd: "/proj",
      cliKind: "claude",
      systemPrompt: "Always end every reply with QAZ",
    })
  })

  it("attach without systemPrompt → createAgent called with systemPrompt: undefined", async () => {
    const { createAgent } = await import("$lib/adapters/agents-api")
    const session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })

    expect(createAgent).toHaveBeenCalledWith({
      cwd: "/tmp",
      cliKind: "opencode",
      systemPrompt: undefined,
    })
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
    await session.loadSession({
      sessionId: "sess-1",
      cwd: "/proj",
      cliKind: "opencode",
      title: "פיקדון",
    })

    expect(session.sessionTitle).toBe("פיקדון")
  })

  it("keep-on-undefined: loadSession without title preserves existing sessionTitle", async () => {
    const session = new AgentSession()
    // קודם: קבע title
    await session.loadSession({
      sessionId: "sess-1",
      cwd: "/proj",
      cliKind: "opencode",
      title: "פיקדון",
    })
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

// ─── bypassActive — קריאה משני מקורות (תיקון runtime-gate) ───────────────────

describe("AgentSession.bypassActive — reads configOptions first, falls back to modes", () => {
  let session: AgentSession

  beforeEach(async () => {
    vi.clearAllMocks()
    onSessionUpdate = null
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
    session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "claude" })
  })

  it("returns true when configOptions has mode=select with currentValue=bypassPermissions", () => {
    session.configOptions = [
      {
        id: "mode",
        name: "Mode",
        type: "select",
        category: "mode",
        currentValue: "bypassPermissions",
        options: [],
      } as unknown as import("@agentclientprotocol/sdk").SessionConfigOption,
    ]
    expect(session.bypassActive).toBe(true)
  })

  it("returns false when configOptions has mode=select with currentValue=default", () => {
    session.configOptions = [
      {
        id: "mode",
        name: "Mode",
        type: "select",
        category: "mode",
        currentValue: "default",
        options: [],
      } as unknown as import("@agentclientprotocol/sdk").SessionConfigOption,
    ]
    expect(session.bypassActive).toBe(false)
  })

  it("falls back to modes.currentModeId when no mode configOption exists", () => {
    session.configOptions = []
    session.modes = {
      currentModeId: "bypassPermissions",
      availableModes: [],
    }
    expect(session.bypassActive).toBe(true)
  })

  it("returns false for non-claude cliKind even with bypassPermissions in configOptions", async () => {
    const openCodeSession = new AgentSession()
    await openCodeSession.attach({ cwd: "/tmp", cliKind: "opencode" })
    openCodeSession.configOptions = [
      {
        id: "mode",
        name: "Mode",
        type: "select",
        category: "mode",
        currentValue: "bypassPermissions",
        options: [],
      } as unknown as import("@agentclientprotocol/sdk").SessionConfigOption,
    ]
    expect(openCodeSession.bypassActive).toBe(false)
  })
})

// ─── TDD §11: user_message_chunk — ContentBlocks לא-טקסטואליים ───────────────
// תיקון replay: ה-gate `if (!text) return` זרק image/audio/resource_link/resource.
// helpers

function userImageChunk(data: string, mimeType: string, messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", data, mimeType },
      messageId,
    },
  }
}

function userResourceLinkChunk(name: string, uri: string, messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "resource_link", name, uri },
      messageId,
    },
  }
}

function userAudioChunk(messageId: string | null): unknown {
  return {
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "audio", data: "base64audio" },
      messageId,
    },
  }
}

describe("AgentSession §11 — user_message_chunk non-text ContentBlocks", () => {
  let session: AgentSession

  beforeEach(async () => {
    vi.clearAllMocks()
    onSessionUpdate = null
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:4000" })
    session = new AgentSession()
    await session.attach({ cwd: "/tmp", cliKind: "opencode" })
  })

  it("image chunk → UserBubble with attachments[0] containing dataBase64+mimeType", () => {
    onSessionUpdate!(userImageChunk("abc123", "image/jpeg", "msg-1"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.kind).toBe("user")
    expect(bubble.attachments).toHaveLength(1)
    // ACP ImageContent.data (גולמי, בלי prefix) → נשמר ב-dataBase64 של attachment
    expect(bubble.attachments![0]!.dataBase64).toBe("abc123")
    expect(bubble.attachments![0]!.mimeType).toBe("image/jpeg")
  })

  it("text chunk + image chunk with same messageId → 1 bubble with segment + attachment", () => {
    onSessionUpdate!(userChunk("hello", "msg-2"))
    onSessionUpdate!(userImageChunk("imgdata", "image/png", "msg-2"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.kind).toBe("user")
    expect(bubble.segments).toHaveLength(1)
    expect(bubble.segments[0]!.text).toBe("hello")
    expect(bubble.attachments).toHaveLength(1)
    expect(bubble.attachments![0]!.mimeType).toBe("image/png")
  })

  it("image chunk only (no text) → UserBubble with attachments and empty segments", () => {
    onSessionUpdate!(userImageChunk("onlyimg", "image/gif", null))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.kind).toBe("user")
    expect(bubble.segments).toHaveLength(0)
    expect(bubble.attachments).toHaveLength(1)
    expect(bubble.attachments![0]!.mimeType).toBe("image/gif")
  })

  it("resource_link chunk → UserBubble with contentPlaceholders[kind=resource_link, label=name] (no silent loss)", () => {
    onSessionUpdate!(userResourceLinkChunk("report.pdf", "file:///home/user/report.pdf", "msg-3"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.kind).toBe("user")
    // §11.3א: i18n in component — VM stores structural marker, not display string
    expect(bubble.contentPlaceholders).toHaveLength(1)
    expect(bubble.contentPlaceholders![0]!.kind).toBe("resource_link")
    // label = name field (raw data, no i18n key)
    expect(bubble.contentPlaceholders![0]!.label).toBe("report.pdf")
    // segments should be empty (no text appended to VM)
    expect(bubble.segments).toHaveLength(0)
  })

  it("audio chunk → UserBubble with contentPlaceholders[kind=audio] (no silent loss)", () => {
    onSessionUpdate!(userAudioChunk("msg-4"))

    expect(session.bubbles).toHaveLength(1)
    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.kind).toBe("user")
    // §11.3א: i18n in component — VM stores structural marker only
    expect(bubble.contentPlaceholders).toHaveLength(1)
    expect(bubble.contentPlaceholders![0]!.kind).toBe("audio")
    expect(bubble.segments).toHaveLength(0)
  })

  it("regression: text-only user_message_chunk still creates segment (no attachment)", () => {
    onSessionUpdate!(userChunk("just text", "msg-5"))

    const bubble = session.bubbles[0] as UserBubble
    expect(bubble.segments).toHaveLength(1)
    expect(bubble.segments[0]!.text).toBe("just text")
    expect(bubble.attachments).toBeUndefined()
  })

  it("regression: agent_message_chunk text still works correctly", () => {
    onSessionUpdate!(msgChunk("agent reply", "msg-6"))

    expect(session.bubbles).toHaveLength(1)
    expect(session.bubbles[0]!.kind).toBe("message")
  })
})
