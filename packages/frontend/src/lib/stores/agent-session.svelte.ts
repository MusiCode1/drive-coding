import type { ServerMessage } from "@drive-coding/core"

// ── Existing types (backward compat) ─────────────────────────────────────────

export type ChatMessage = {
  id: string
  kind: "user" | "assistant" | "thought" | "tool_call"
  text: string
  isStreaming?: boolean
  // tool_call extra metadata (Slice 5.5)
  toolCallId?: string
  toolKind?: string
  toolStatus?: string
  toolLocations?: string[]
  toolContent?: string
}

export type AgentSessionStatus = "disconnected" | "connecting" | "connected" | "thinking"

// ── Phase 2: Bubble types ─────────────────────────────────────────────────────

/** The visual kind of a bubble (maps to distinct styling in BubbleKind.svelte). */
export type BubbleKind = "thought" | "tool" | "message" | "user"

/**
 * One segment within a bubble.
 * - text / message bubbles: `text` holds the content.
 * - thought bubbles: `text` = translated Hebrew, `originalText` = original English.
 * - tool bubbles: `toolCallId` + `toolTitle` + optional `narration`.
 * - user bubbles: `text` = STT transcript.
 *
 * Populated progressively:
 *   Phase 2: text, toolCallId, toolTitle, narration (from WS tool_call / tool_call_update)
 *   Phase 5: originalText, translatedText (from audio_chunk)
 *   Phase 6: historical flag (from history_chunk)
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
  /** Stable UUID from server — used for Tier 1 grouping. null for events without messageId. */
  messageId: string | null
  segments: BubbleSegment[]
}

/** Public contract of createAgentSessionStore — used for dependency injection and type safety. */
export interface AgentSessionPublic {
  readonly agentId: string
  readonly messages: ChatMessage[]
  /** Phase 2: new visual bubble list (replaces messages for rendering). */
  readonly bubbles: Bubble[]
  /** Phase 6: true while history events are being replayed. */
  readonly isLoadingHistory: boolean
  readonly status: AgentSessionStatus
  readonly error: string | null
  readonly isConnected: boolean
  connect(): void
  disconnect(): void
  sendPrompt(text: string): void
  sendRaw(payload: unknown): boolean
  cancel(): void
  setVoiceMessageHandler(handler: (raw: string) => void): void
  /** Phase 6: clear all bubbles (used by history_start). */
  clearBubbles(): void
  /** Phase 6: get the last saved recording ID (from audio_recording_saved). */
  getRecordingId(): string | null
  /**
   * B10 bridge: called by voice-session when audio_chunk arrives with translation.
   * Adds a translated segment (text=Hebrew, originalText=English) to the bubble
   * identified by messageId + kind.
   */
  addTranslatedSegment(
    messageId: string,
    kind: "message" | "thought",
    originalText: string,
    translatedText: string,
  ): void
}

/**
 * createAgentSessionStore — Svelte 5 rune-based store for a single agent WS session.
 *
 * Phase 2 additions:
 *  - `bubbles` state: per-kind bubbles with sub-segments, grouped by messageId
 *  - Bubble grouping logic for text_chunk, tool_call, tool_call_update, stt_partial
 *
 * Phase 5 will extend with: audio_chunk originalText/translatedText pairing
 * Phase 6 will extend with: history_* events, historical bubble flag
 */
export function createAgentSessionStore(agentId: string): AgentSessionPublic {
  let messages = $state<ChatMessage[]>([])
  let bubbles = $state<Bubble[]>([])
  let status = $state<AgentSessionStatus>("disconnected")
  let error = $state<string | null>(null)
  let ws = $state<WebSocket | null>(null)
  /** Phase 6: true while history_* events are streaming. */
  let isLoadingHistory = $state(false)
  /** Phase 6: most recently saved recording ID (from audio_recording_saved). */
  let lastRecordingId = $state<string | null>(null)

  // Reconnect state
  let retryCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let intentionallyClosed = false

  // Voice message delegate
  let voiceMessageHandler: ((raw: string) => void) | null = null

  // ── Legacy messages helpers ───────────────────────────────────────────────

  function appendChunk(kind: ChatMessage["kind"], text: string): void {
    const last = messages[messages.length - 1]
    if (last && last.kind === kind && last.isStreaming) {
      messages = [...messages.slice(0, -1), { ...last, text: last.text + text }]
    } else {
      messages = [
        ...messages,
        {
          id: crypto.randomUUID(),
          kind,
          text,
          isStreaming: true,
        },
      ]
    }
  }

  function finalizeStreaming(): void {
    messages = messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    bubbles = bubbles.map((b) => ({
      ...b,
      segments: b.segments.map((s) => (s.isStreaming ? { ...s, isStreaming: false } : s)),
    }))
  }

  function upsertStreamingUser(text: string): void {
    const last = messages[messages.length - 1]
    if (last && last.kind === "user" && last.isStreaming) {
      messages = [...messages.slice(0, -1), { ...last, text }]
    } else {
      messages = [
        ...messages,
        {
          id: crypto.randomUUID(),
          kind: "user",
          text,
          isStreaming: true,
        },
      ]
    }
  }

  // ── Phase 2: Bubble helpers ───────────────────────────────────────────────

  /**
   * Append a text chunk to the bubble list.
   *
   * Grouping rule: same kind AND same messageId (null == null) → concatenate text
   * into the last segment of the existing bubble (B1 fix). Otherwise → new bubble.
   *
   * B1 fix: instead of creating a new BubbleSegment per text_chunk (which caused
   * every token to appear as a separate visual "sticker"), we concat text into the
   * last segment so the full message renders as one contiguous string.
   */
  function appendBubbleChunk(
    kind: "message" | "thought",
    text: string,
    messageId: string | null,
    opts?: { originalText?: string; translatedText?: string },
  ): void {
    const last = bubbles[bubbles.length - 1]
    if (last && last.kind === kind && last.messageId === messageId) {
      // Same bubble: concatenate into the last segment instead of creating a new one.
      const lastSeg = last.segments[last.segments.length - 1]
      if (lastSeg) {
        const updatedSeg: BubbleSegment = {
          ...lastSeg,
          text: (lastSeg.text ?? "") + text,
          // Optionally update translation metadata (used by audio_chunk bridge in B10)
          ...(opts?.originalText !== undefined ? { originalText: opts.originalText } : {}),
          ...(opts?.translatedText !== undefined ? { translatedText: opts.translatedText } : {}),
        }
        bubbles = [
          ...bubbles.slice(0, -1),
          { ...last, segments: [...last.segments.slice(0, -1), updatedSeg] },
        ]
      } else {
        // Empty segments array (defensive) — create first segment
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

  /**
   * Create or update a tool bubble.
   * Lookup by toolCallId — if found, update title/narration; else create new.
   */
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

  /**
   * B10 bridge: add a translated segment (originalText=English, text=Hebrew)
   * to the bubble identified by messageId + kind.
   *
   * Called by voice-session when audio_chunk arrives with originalText/translatedText.
   * Appends a new segment so SubSegment renders both original + translation.
   */
  function addTranslatedSegment(
    messageId: string,
    kind: "message" | "thought",
    originalText: string,
    translatedText: string,
  ): void {
    // Find the bubble by kind + messageId (search from end — most recent)
    const idx = [...bubbles]
      .reverse()
      .findIndex((b) => b.kind === kind && b.messageId === messageId)
    if (idx < 0) return // no matching bubble — nothing to update
    const realIdx = bubbles.length - 1 - idx
    const bubble = bubbles[realIdx]
    if (!bubble) return

    const newSegment: BubbleSegment = {
      text: translatedText,
      originalText,
      translatedText,
    }
    bubbles = bubbles.map((b, i) =>
      i === realIdx ? { ...b, segments: [...b.segments, newSegment] } : b,
    )
  }

  /**
   * Create or update streaming user bubble (from stt_partial).
   * Only ONE streaming user bubble can exist at a time — update it in place.
   */
  function upsertBubbleUser(text: string): void {
    const idx = bubbles.findIndex((b) => b.kind === "user" && b.segments.some((s) => s.isStreaming))
    if (idx >= 0) {
      bubbles = bubbles.map((b, i) =>
        i === idx
          ? {
              ...b,
              segments: b.segments.map((s) => (s.isStreaming ? { ...s, text } : s)),
            }
          : b,
      )
    } else {
      bubbles = [
        ...bubbles,
        { kind: "user", messageId: null, segments: [{ text, isStreaming: true }] },
      ]
    }
  }

  // ── WS message handler ────────────────────────────────────────────────────

  function handle(raw: string): void {
    voiceMessageHandler?.(raw)

    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch (e) {
      error = `parse error: ${e}`
      return
    }

    switch (msg.type) {
      case "connected":
        status = "connected"
        error = null
        break

      case "thinking":
        status = "thinking"
        break

      case "text_chunk": {
        const messageId = msg.messageId ?? null
        appendChunk(msg.kind === "message" ? "assistant" : "thought", msg.text)
        appendBubbleChunk(msg.kind === "message" ? "message" : "thought", msg.text, messageId)
        break
      }

      case "tool_call": {
        // Legacy messages — merge by toolCallId
        const existing = messages.find(
          (m) => m.kind === "tool_call" && m.toolCallId === msg.toolCallId,
        )
        if (existing) {
          messages = messages.map((m) =>
            m === existing
              ? {
                  ...m,
                  text: msg.title || m.text,
                  toolKind: msg.kind ?? m.toolKind,
                  toolStatus: msg.status ?? m.toolStatus,
                  toolLocations: msg.locations ?? m.toolLocations,
                  toolContent: msg.content ?? m.toolContent,
                }
              : m,
          )
        } else {
          messages = [
            ...messages,
            {
              id: crypto.randomUUID(),
              kind: "tool_call",
              text: msg.title,
              toolCallId: msg.toolCallId,
              toolKind: msg.kind,
              toolStatus: msg.status,
              toolLocations: msg.locations,
              toolContent: msg.content,
            },
          ]
        }
        // Phase 2: bubbles — create/update tool bubble
        appendToolBubble(msg.toolCallId, msg.title, { narration: msg.narration })
        break
      }

      case "tool_call_update":
        // Phase 2: update narration on existing tool bubble
        updateToolNarration(msg.toolCallId, msg.narration)
        break

      case "done":
        finalizeStreaming()
        status = "connected"
        break

      case "error":
        error = `${msg.code}: ${msg.message}`
        status = "connected"
        break

      case "stt_partial":
        upsertStreamingUser(msg.text)
        upsertBubbleUser(msg.text)
        break

      // ── Phase 6: Slice 8a history events ─────────────────────────────────

      case "history_start":
        // Clear existing state, enter history loading mode (no auto-play)
        messages = []
        bubbles = []
        isLoadingHistory = true
        break

      case "history_chunk": {
        // Same grouping logic as text_chunk, but segments are marked historical
        const hKind = msg.kind === "user_message" ? "user" : (msg.kind as "message" | "thought")
        const hSegment: BubbleSegment = { text: msg.text, historical: true }
        const last = bubbles[bubbles.length - 1]
        if (last && last.kind === hKind && last.messageId === msg.messageId) {
          bubbles = [...bubbles.slice(0, -1), { ...last, segments: [...last.segments, hSegment] }]
        } else {
          bubbles = [...bubbles, { kind: hKind, messageId: msg.messageId, segments: [hSegment] }]
        }
        break
      }

      case "history_tool_call":
        bubbles = [
          ...bubbles,
          {
            kind: "tool",
            messageId: null,
            segments: [{ toolCallId: msg.toolCallId, toolTitle: msg.title, historical: true }],
          },
        ]
        break

      case "history_done":
        isLoadingHistory = false
        break

      case "audio_recording_saved":
        // Store the latest recording ID — associated with the most recent user message
        lastRecordingId = msg.recordingId
        break

      default:
        // pong, hello, audio_chunk, translation — handled by voiceMessageHandler or ignored
        break
    }
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000]

  function scheduleReconnect(): void {
    if (retryTimer !== null) return
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)] ?? 30000
    const attempt = retryCount + 1
    error = `מתחבר מחדש... (ניסיון ${attempt})`
    retryTimer = setTimeout(() => {
      retryTimer = null
      retryCount++
      connect()
    }, delay)
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  function connect(): void {
    if (ws) return
    intentionallyClosed = false
    status = "connecting"
    error = null

    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    ws = new WebSocket(`${proto}//${location.host}/ws/agent/${agentId}`)

    ws.onmessage = (e) => handle(String(e.data))

    ws.onopen = () => {
      retryCount = 0
    }

    ws.onerror = () => {
      error = "WebSocket connection error"
    }

    ws.onclose = () => {
      status = "disconnected"
      ws = null
      if (!intentionallyClosed) {
        scheduleReconnect()
      }
    }
  }

  function disconnect(): void {
    intentionallyClosed = true
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    ws?.close()
    ws = null
    status = "disconnected"
    error = null
  }

  function sendPrompt(text: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      kind: "user",
      text,
    }
    messages = [...messages, userMsg]
    // Phase 2: add user bubble for typed messages too
    bubbles = [...bubbles, { kind: "user", messageId: null, segments: [{ text }] }]
    ws.send(JSON.stringify({ type: "prompt", text }))
  }

  function sendRaw(payload: unknown): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(payload))
    return true
  }

  function cancel(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: "cancel" }))
  }

  function setVoiceMessageHandler(handler: (raw: string) => void): void {
    voiceMessageHandler = handler
  }

  /** Phase 6: clear bubbles for history reload. */
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
      return ws !== null && ws.readyState === WebSocket.OPEN
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
  }
}
