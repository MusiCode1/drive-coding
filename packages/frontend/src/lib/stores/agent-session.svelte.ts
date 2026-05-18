import type { SessionNotification } from "@agentclientprotocol/sdk"
import { createAcpClient } from "$lib/acp/client"
import { createLogger } from "$lib/log"

const baseLog = createLogger("fe.session")

// ── Types ─────────────────────────────────────────────────────────────────────

export type BubbleKind = "thought" | "tool" | "message" | "user"

/**
 * One segment within a bubble.
 * - text / message bubbles: `text` holds the content.
 * - thought bubbles: `text` = translated Hebrew, `originalText` = original English.
 * - tool bubbles: `toolCallId` + `toolTitle` + optional `narration`.
 * - user bubbles: `text` = STT transcript.
 *
 * Populated progressively:
 *   Phase 2: text, toolCallId, toolTitle, narration (from ACP sessionUpdate notifications)
 *   Phase 5: originalText, translatedText (from audio_chunk / translate flow)
 */
export type BubbleSegment = {
  text?: string
  originalText?: string
  translatedText?: string
  // tool_call specific
  toolCallId?: string
  toolTitle?: string
  narration?: string
  // metadata
  historical?: boolean
  isStreaming?: boolean
}

/** A grouped visual bubble containing one or more segments. */
export type Bubble = {
  kind: BubbleKind
  /** Stable UUID from agent — used for grouping. null for events without messageId. */
  messageId: string | null
  segments: BubbleSegment[]
}

/**
 * Phase 2 status machine:
 * - "spawning"   — initial, before connect() called or POST /api/agents in progress
 * - "connecting" — WS open, ACP handshake in progress
 * - "connected"  — session-attached confirmed by BE; ready for prompts
 * - "thinking"   — prompt sent, response in progress (set by voice orchestrator Phase 3)
 * - "crashed"    — bridge crashed (WS close 1011) or multi-tab collision (1008)
 * - "disconnected" — WS closed unexpectedly (no auto-reconnect)
 */
export type AgentSessionStatus =
  | "spawning"
  | "connecting"
  | "connected"
  | "thinking"
  | "crashed"
  | "disconnected"

// Kept for backward compat (voice-session.svelte.ts still uses legacy messages)
export type ChatMessage = {
  id: string
  kind: "user" | "assistant" | "thought" | "tool_call"
  text: string
  isStreaming?: boolean
  toolCallId?: string
  toolKind?: string
  toolStatus?: string
  toolLocations?: string[]
  toolContent?: string
}

/** Public contract of createAgentSessionStore */
export interface AgentSessionPublic {
  readonly agentId: string
  readonly messages: ChatMessage[]
  readonly bubbles: Bubble[]
  readonly isLoadingHistory: boolean
  readonly status: AgentSessionStatus
  readonly error: string | null
  readonly isConnected: boolean
  connect(): Promise<void> | void
  disconnect(): void
  sendPrompt(text: string): void
  sendRaw(payload: unknown): boolean
  cancel(): void
  setVoiceMessageHandler(handler: (raw: string) => void): void
  clearBubbles(): void
  getRecordingId(): string | null
  addTranslatedSegment(
    messageId: string,
    kind: "message" | "thought",
    originalText: string,
    translatedText: string,
  ): void
  /**
   * Test helper: inject a raw ACP sessionUpdate notification directly.
   * Used by unit tests that want to test bubble accumulation without a full ACP handshake.
   * Should NOT be called in production code.
   * @internal
   */
  _testInjectNotification?: (notification: unknown) => void
}

// ── Store factory ─────────────────────────────────────────────────────────────

/**
 * createAgentSessionStore — Phase 2 ACP-based store.
 *
 * Replaces the old direct-WS / server-protocol flow with:
 * 1. POST /api/agents → { agentId, bridgePort, status, acpSessionId? }
 * 2. createAcpClient(agentId) → ACP handshake → sessionId
 * 3. POST /api/agents/:id/session-attached { sessionId }
 * 4. Bubble accumulation from sessionUpdate notifications (agent_message_chunk, etc.)
 *
 * Note: agentId parameter is the EXISTING agent id from routing (already spawned).
 * connect() will call POST /api/agents to get/create the actual bridge.
 */
export function createAgentSessionStore(agentId: string): AgentSessionPublic {
  const log = baseLog.child({ agentId })

  // ── State ──────────────────────────────────────────────────────────────────
  let messages = $state<ChatMessage[]>([])
  let bubbles = $state<Bubble[]>([])
  let status = $state<AgentSessionStatus>("spawning")
  let error = $state<string | null>(null)
  let isLoadingHistory = $state(false)
  let lastRecordingId = $state<string | null>(null)

  // ACP client (set after successful connect)
  let acpClient: Awaited<ReturnType<typeof createAcpClient>> | null = null
  let currentSessionId: string | null = null

  // Voice message delegate (Phase 3)
  let voiceMessageHandler: ((raw: string) => void) | null = null

  // ── Bubble helpers ─────────────────────────────────────────────────────────

  /**
   * Append a text chunk to the bubble list.
   * Grouping rule: same kind AND same messageId → concat text into last segment (B1 fix).
   * Otherwise → new bubble.
   */
  function appendBubbleChunk(
    kind: "message" | "thought",
    text: string,
    messageId: string | null,
    opts?: { originalText?: string; translatedText?: string },
  ): void {
    const last = bubbles[bubbles.length - 1]
    if (last && last.kind === kind && last.messageId === messageId) {
      const lastSeg = last.segments[last.segments.length - 1]
      if (lastSeg) {
        const updatedSeg: BubbleSegment = {
          ...lastSeg,
          text: (lastSeg.text ?? "") + text,
          ...(opts?.originalText !== undefined ? { originalText: opts.originalText } : {}),
          ...(opts?.translatedText !== undefined ? { translatedText: opts.translatedText } : {}),
        }
        bubbles = [
          ...bubbles.slice(0, -1),
          { ...last, segments: [...last.segments.slice(0, -1), updatedSeg] },
        ]
      } else {
        bubbles = [
          ...bubbles.slice(0, -1),
          {
            ...last,
            segments: [
              { text, originalText: opts?.originalText, translatedText: opts?.translatedText },
            ],
          },
        ]
      }
    } else {
      bubbles = [
        ...bubbles,
        {
          kind,
          messageId,
          segments: [
            { text, originalText: opts?.originalText, translatedText: opts?.translatedText },
          ],
        },
      ]
    }
  }

  /** Create or update a tool bubble. Lookup by toolCallId. */
  function appendToolBubble(
    toolCallId: string,
    toolTitle: string,
    opts?: { narration?: string },
  ): void {
    const existingIdx = bubbles.findIndex(
      (b) => b.kind === "tool" && b.segments.some((s) => s.toolCallId === toolCallId),
    )
    if (existingIdx >= 0) {
      bubbles = bubbles.map((b, i) =>
        i === existingIdx
          ? {
              ...b,
              segments: b.segments.map((s) =>
                s.toolCallId === toolCallId
                  ? {
                      ...s,
                      toolTitle: toolTitle || s.toolTitle,
                      narration: opts?.narration ?? s.narration,
                    }
                  : s,
              ),
            }
          : b,
      )
    } else {
      bubbles = [
        ...bubbles,
        {
          kind: "tool",
          messageId: null,
          segments: [{ toolCallId, toolTitle, narration: opts?.narration }],
        },
      ]
    }
  }

  /** Update narration on existing tool bubble segment (from tool_call_update). */
  function updateToolNarration(toolCallId: string, narration: string): void {
    bubbles = bubbles.map((b) => {
      if (b.kind !== "tool") return b
      if (!b.segments.some((s) => s.toolCallId === toolCallId)) return b
      return {
        ...b,
        segments: b.segments.map((s) => (s.toolCallId === toolCallId ? { ...s, narration } : s)),
      }
    })
  }

  /** B10 bridge: add translated segment to bubble identified by messageId + kind. */
  function addTranslatedSegment(
    messageId: string,
    kind: "message" | "thought",
    originalText: string,
    translatedText: string,
  ): void {
    const idx = [...bubbles]
      .reverse()
      .findIndex((b) => b.kind === kind && b.messageId === messageId)
    if (idx < 0) return
    const realIdx = bubbles.length - 1 - idx
    const bubble = bubbles[realIdx]
    if (!bubble) return

    const newSegment: BubbleSegment = { text: translatedText, originalText, translatedText }
    bubbles = bubbles.map((b, i) =>
      i === realIdx ? { ...b, segments: [...b.segments, newSegment] } : b,
    )
  }

  /** Create or update streaming user bubble (stt_partial). */
  function upsertBubbleUser(text: string): void {
    const idx = bubbles.findIndex((b) => b.kind === "user" && b.segments.some((s) => s.isStreaming))
    if (idx >= 0) {
      bubbles = bubbles.map((b, i) =>
        i === idx
          ? { ...b, segments: b.segments.map((s) => (s.isStreaming ? { ...s, text } : s)) }
          : b,
      )
    } else {
      bubbles = [
        ...bubbles,
        { kind: "user", messageId: null, segments: [{ text, isStreaming: true }] },
      ]
    }
  }

  function finalizeStreaming(): void {
    bubbles = bubbles.map((b) => ({
      ...b,
      segments: b.segments.map((s) => (s.isStreaming ? { ...s, isStreaming: false } : s)),
    }))
    messages = messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
  }

  // ── Legacy messages helpers (for voice-session.svelte.ts compat) ───────────

  function appendChunk(kind: ChatMessage["kind"], text: string): void {
    const last = messages[messages.length - 1]
    if (last && last.kind === kind && last.isStreaming) {
      messages = [...messages.slice(0, -1), { ...last, text: last.text + text }]
    } else {
      messages = [...messages, { id: crypto.randomUUID(), kind, text, isStreaming: true }]
    }
  }

  function upsertStreamingUser(text: string): void {
    const last = messages[messages.length - 1]
    if (last && last.kind === "user" && last.isStreaming) {
      messages = [...messages.slice(0, -1), { ...last, text }]
    } else {
      messages = [...messages, { id: crypto.randomUUID(), kind: "user", text, isStreaming: true }]
    }
  }

  // ── ACP sessionUpdate handler ─────────────────────────────────────────────

  /**
   * Handle a raw ACP sessionUpdate notification.
   * Notification types from opencode ACP:
   * - agent_message_chunk — assistant text streaming
   * - agent_thought_chunk — assistant thought/reasoning
   * - tool_call           — tool invocation started
   * - tool_call_update    — tool narration update
   *
   * Also forwards to voiceMessageHandler for Phase 3 voice orchestration.
   */
  function handleSessionUpdate(notification: SessionNotification): void {
    // Forward to voice handler (Phase 3)
    voiceMessageHandler?.(JSON.stringify(notification))

    const n = notification as {
      type?: string
      messageId?: string
      text?: string
      toolCallId?: string
      title?: string
      kind?: string
      status?: string
      locations?: string[]
      content?: string
      narration?: string
      stopReason?: string
    }

    switch (n.type) {
      case "agent_message_chunk": {
        const messageId = n.messageId ?? null
        appendChunk("assistant", n.text ?? "")
        appendBubbleChunk("message", n.text ?? "", messageId)
        break
      }

      case "agent_thought_chunk": {
        const messageId = n.messageId ?? null
        appendChunk("thought", n.text ?? "")
        appendBubbleChunk("thought", n.text ?? "", messageId)
        break
      }

      case "tool_call": {
        const toolCallId = n.toolCallId ?? ""
        const title = n.title ?? ""
        // Legacy messages
        const existing = messages.find((m) => m.kind === "tool_call" && m.toolCallId === toolCallId)
        if (existing) {
          messages = messages.map((m) =>
            m === existing
              ? {
                  ...m,
                  text: title || m.text,
                  toolKind: n.kind ?? m.toolKind,
                  toolStatus: n.status ?? m.toolStatus,
                  toolLocations: n.locations ?? m.toolLocations,
                  toolContent: n.content ?? m.toolContent,
                }
              : m,
          )
        } else {
          messages = [
            ...messages,
            {
              id: crypto.randomUUID(),
              kind: "tool_call",
              text: title,
              toolCallId,
              toolKind: n.kind,
              toolStatus: n.status,
              toolLocations: n.locations,
              toolContent: n.content,
            },
          ]
        }
        // Bubbles
        appendToolBubble(toolCallId, title, { narration: n.narration })
        break
      }

      case "tool_call_update": {
        if (n.toolCallId && n.narration) {
          updateToolNarration(n.toolCallId, n.narration)
        }
        break
      }

      case "stt_partial": {
        upsertStreamingUser(n.text ?? "")
        upsertBubbleUser(n.text ?? "")
        break
      }

      case "done":
      case "end_turn": {
        finalizeStreaming()
        break
      }

      default:
        // pong, hello, audio_chunk, etc. — handled by voiceMessageHandler or ignored
        break
    }
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  async function connect(): Promise<void> {
    if (status === "connecting" || status === "connected") return

    status = "connecting"
    error = null
    log.info({}, "ACP connect start")

    try {
      // 1. Create ACP client (handshake: WS open + connected frame + warmup + initialize)
      // MED-8: onClose handles WS close codes:
      //   1008 = "agent in use by another tab" (ws-agent.ts closes the second feWs)
      //   1011 = "bridge crashed" (ws-agent.ts closes feWs when bridge dies)
      const handleWsClose = (code: number, reason: string) => {
        if (code === 1008) {
          error = "סוכן בשימוש ב-tab אחר"
          status = "crashed"
          acpClient = null
          log.warn({ code, reason }, "WS closed: agent in use by another tab")
        } else if (code === 1011) {
          error = `Bridge נכשל: ${reason || "bridge closed"}`
          status = "crashed"
          acpClient = null
          log.warn({ code, reason }, "WS closed: bridge crashed")
        } else if (code !== 1000 && code !== 1001) {
          // Unexpected close — show reconnect UI
          error = "חיבור נפל — רענן את הדף"
          status = "disconnected"
          acpClient = null
          log.warn({ code, reason }, "WS closed unexpectedly")
        }
      }
      acpClient = await createAcpClient(agentId, handleSessionUpdate, handleWsClose)

      // 2. Create a new session (or load existing — Phase 3 will handle existingSessionId)
      const sessionResult = await acpClient.newSession({ cwd: "/" })
      currentSessionId = (sessionResult as { sessionId?: string }).sessionId ?? null

      // 3. Notify BE that session is attached (MED-9: prompt blocked until this succeeds)
      if (currentSessionId) {
        await fetch(`/api/agents/${agentId}/session-attached`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: currentSessionId }),
        })
      }

      status = "connected"
      log.info({ sessionId: currentSessionId }, "ACP connected")
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      const errKind = (e as Error & { kind?: string }).kind

      if (errKind === "auth_required") {
        error = `הסוכן דורש login — הפעל '<cli> auth login' ב-shell`
      } else {
        error = `חיבור נכשל: ${errMsg}`
      }

      status = "disconnected"
      acpClient = null
      log.warn({ err: errMsg }, "ACP connect failed")
    }
  }

  function disconnect(): void {
    acpClient?.close()
    acpClient = null
    currentSessionId = null
    status = "spawning"
    error = null
    voiceMessageHandler = null
    log.info({}, "ACP disconnected")
  }

  /**
   * Send a text prompt via ACP.
   * MED-9: guarded by status === "connected" — will not send if not fully connected.
   */
  function sendPrompt(text: string): void {
    if (status !== "connected" && status !== "thinking") {
      log.warn({ status }, "sendPrompt rejected — not connected")
      return
    }

    // Add user bubble
    messages = [...messages, { id: crypto.randomUUID(), kind: "user", text }]
    bubbles = [...bubbles, { kind: "user", messageId: null, segments: [{ text }] }]

    if (!acpClient || !currentSessionId) {
      log.warn({}, "sendPrompt: no acpClient or sessionId")
      return
    }

    acpClient.prompt(currentSessionId, text).catch((e) => {
      error = `Prompt failed: ${e instanceof Error ? e.message : String(e)}`
      log.error({ err: String(e) }, "prompt failed")
    })
  }

  /**
   * sendRaw — backward compat for voice-session.svelte.ts (will be removed Phase 3+).
   * No-op in ACP mode (returns false if not connected).
   */
  function sendRaw(_payload: unknown): boolean {
    // ACP mode: raw WS protocol no longer used
    return status === "connected"
  }

  function cancel(): void {
    if (acpClient && currentSessionId) {
      acpClient.cancel(currentSessionId).catch(() => {})
    }
  }

  function setVoiceMessageHandler(handler: (raw: string) => void): void {
    voiceMessageHandler = handler
  }

  function clearBubbles(): void {
    bubbles = []
    messages = []
    isLoadingHistory = false
    lastRecordingId = null
  }

  return {
    agentId,
    get messages() {
      return messages
    },
    get bubbles() {
      return bubbles
    },
    get isLoadingHistory() {
      return isLoadingHistory
    },
    get status() {
      return status
    },
    get error() {
      return error
    },
    get isConnected() {
      return status === "connected" || status === "thinking"
    },
    connect,
    disconnect,
    sendPrompt,
    sendRaw,
    cancel,
    setVoiceMessageHandler,
    clearBubbles,
    getRecordingId() {
      return lastRecordingId
    },
    addTranslatedSegment,
    _testInjectNotification(notification: unknown) {
      handleSessionUpdate(notification as SessionNotification)
    },
  }
}
