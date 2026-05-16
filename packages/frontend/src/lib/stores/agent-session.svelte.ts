import type { ServerMessage } from "@drive-coding/core"

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

/** Public contract of createAgentSessionStore — used for dependency injection and type safety. */
export interface AgentSessionPublic {
  readonly agentId: string
  readonly messages: ChatMessage[]
  readonly status: AgentSessionStatus
  readonly error: string | null
  readonly isConnected: boolean
  connect(): void
  disconnect(): void
  sendPrompt(text: string): void
  sendRaw(payload: unknown): boolean
  cancel(): void
  setVoiceMessageHandler(handler: (raw: string) => void): void
}

/**
 * createAgentSessionStore — Svelte 5 rune-based store for a single agent WS session.
 *
 * Manages:
 *  - WS connection lifecycle (with exponential backoff reconnect)
 *  - Chat message list (with streaming append)
 *  - Status and error state
 *
 * Slice 5: extended with:
 *  - onVoiceMessage callback for voice pipeline message delegation
 *  - sendRaw for sending arbitrary JSON via WS (used by voice store)
 *
 * Slice 7 fix: exponential backoff reconnect on unexpected WS close.
 *
 * Usage: call in a .svelte file, use returned reactive fields directly.
 */
export function createAgentSessionStore(agentId: string): AgentSessionPublic {
  let messages = $state<ChatMessage[]>([])
  let status = $state<AgentSessionStatus>("disconnected")
  let error = $state<string | null>(null)
  let ws = $state<WebSocket | null>(null)

  // Reconnect state
  let retryCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let intentionallyClosed = false

  // Slice 5: voice message delegate
  let voiceMessageHandler: ((raw: string) => void) | null = null

  function appendChunk(kind: ChatMessage["kind"], text: string): void {
    const last = messages[messages.length - 1]
    if (last && last.kind === kind && last.isStreaming) {
      // Append to the last streaming message of the same kind
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
  }

  function handle(raw: string): void {
    // Delegate to voice handler if registered (processes audio_chunk, stt_partial, etc.)
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
      case "text_chunk":
        appendChunk(msg.kind === "message" ? "assistant" : "thought", msg.text)
        break
      case "tool_call": {
        // Same toolCallId may arrive multiple times (initial + updates).
        // Merge into existing bubble if found.
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
        break
      }
      case "done":
        finalizeStreaming()
        status = "connected"
        break
      case "error":
        error = `${msg.code}: ${msg.message}`
        status = "connected"
        break
      default:
        // pong, hello, stt_partial, audio_chunk, translation — handled by voiceMessageHandler or ignored
        break
    }
  }

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

  function connect(): void {
    if (ws) return
    intentionallyClosed = false
    status = "connecting"
    error = null

    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    ws = new WebSocket(`${proto}//${location.host}/ws/agent/${agentId}`)

    ws.onmessage = (e) => handle(String(e.data))

    ws.onopen = () => {
      // status will be set to "connected" via "connected" server message
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
    ws.send(JSON.stringify({ type: "prompt", text }))
  }

  /** Send arbitrary JSON payload via WS. Used by voice pipeline to send audio messages. */
  function sendRaw(payload: unknown): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(payload))
    return true
  }

  function cancel(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: "cancel" }))
  }

  /** Register a voice message handler (called with every raw WS message). */
  function setVoiceMessageHandler(handler: (raw: string) => void): void {
    voiceMessageHandler = handler
  }

  return {
    agentId,
    get messages() {
      return messages
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
  }
}
