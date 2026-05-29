/**
 * AgentSession — minimal view-model for a single ACP session.
 *
 * Owns:
 *   - connection state (status, error)
 *   - bubble accumulation from session/update notifications
 *   - public methods: attach/detach/sendPrompt
 *
 * Uses the transport-agnostic AcpClient from @drive-coding/core/acp,
 * wrapped with the FE-side WsAcpTransport.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import { createAcpClient, type AcpClient } from "@drive-coding/core/acp/client"
import { WsAcpTransport } from "$lib/engines/ws-transport"
import { createAgent, notifySessionAttached } from "$lib/adapters/agents-api"
import { beWsUrl } from "$lib/util/be-url"
import type { CliKind } from "@drive-coding/core"
import type { Bubble, MessageBubble, Segment, ThoughtBubble, UserBubble } from "$lib/types/bubble"

export type AgentSessionStatus =
  | "idle" // no agent yet
  | "connecting" // creating agent + ACP handshake
  | "connected" // ready to receive prompts
  | "thinking" // prompt sent, awaiting agent response
  | "error"

/**
 * ─── Parallel-safe additive design (docs/conventions/parallel-safe-code.md) ───
 *
 * Adding a new method to AgentSession:
 *   - State changes (`$state` fields) → INVASIVE. Stop and ask Tama.
 *   - New public method (`loadSession`, etc.) → ADDITIVE. Place it in the
 *     appropriate `// ─── domain ───` block, or append a new block before
 *     `// ─── private ───`.
 *   - New private helper → ADDITIVE. Place in `// ─── private ───`.
 */
export class AgentSession {
  // ─── state ─── (INVASIVE to modify — coordinate via Tama)
  status = $state<AgentSessionStatus>("idle")
  error = $state<string | null>(null)
  bubbles = $state<Bubble[]>([])
  agentId = $state<string | null>(null)
  cwd = $state<string | null>(null)

  #client: AcpClient | null = null
  #sessionId: string | null = null
  /**
   * True between detach() and the next attach(). Suppresses spurious
   * `WS closed (1005)` errors from onClose firing after the user
   * explicitly disconnected.
   */
  #detached = false

  // ─── connection lifecycle ─────────────────────────

  /**
   * Create a new agent for (cwd, cliKind), open WS, handshake ACP, register
   * notification handler. After resolution the session is ready for sendPrompt.
   */
  attach = async (input: { cwd: string; cliKind: CliKind }): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot attach in status ${this.status}`)
    }
    this.status = "connecting"
    this.error = null
    this.bubbles = []
    this.#detached = false

    try {
      // 1. Create agent on the BE
      const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
      this.agentId = agentId
      this.cwd = input.cwd

      // 2. Open WS transport
      const transport = new WsAcpTransport(beWsUrl(`/ws/agent/${agentId}`))
      transport.onClose((code, reason) => {
        // Suppress errors when the close was caused by an explicit detach().
        // The browser closes the WS asynchronously, so onClose fires after detach
        // has already cleared state.
        if (this.#detached) return
        if (code !== 1000 && code !== 1001) {
          this.error = `WS closed (${code}): ${reason || "no reason"}`
          this.status = "error"
        }
      })
      await transport.waitForOpen()

      // 3. ACP handshake + new session
      this.#client = await createAcpClient(transport, this.#onSessionUpdate)
      const sessionResult = await this.#client.newSession({ cwd: input.cwd })
      this.#sessionId = (sessionResult as { sessionId?: string }).sessionId ?? null
      if (!this.#sessionId) {
        throw new Error("newSession returned no sessionId")
      }

      // 4. Tell BE which sessionId we attached (best-effort)
      await notifySessionAttached(agentId, this.#sessionId).catch(() => {})

      this.status = "connected"
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.error = msg
      this.status = "error"
      this.#cleanup()
    }
  }

  detach = (): void => {
    this.#detached = true // ‏לפני ה-cleanup — ‏ה-WS close fires async
    this.#cleanup()
    this.status = "idle"
    this.error = null
    this.bubbles = []
  }

  // ─── prompting ────────────────────────────────────

  /**
   * Send a text prompt. `opts.recordingId` is reserved for slice 10 (replay).
   * Returns a Promise that resolves when the turn completes (or rejects on error).
   */
  sendPrompt = async (text: string, opts?: { recordingId?: string }): Promise<void> => {
    if (this.status !== "connected" && this.status !== "thinking") return
    if (!this.#client || !this.#sessionId) return
    if (!text.trim()) return

    // optimistic: add user bubble immediately (single segment, no messageId)
    const userBubble: UserBubble = {
      id: crypto.randomUUID(),
      kind: "user",
      messageId: null,
      createdAt: Date.now(),
      segments: [{ id: crypto.randomUUID(), text }],
      ...(opts?.recordingId !== undefined ? { recordingId: opts.recordingId } : {}),
    }
    this.bubbles.push(userBubble)
    this.status = "thinking"

    try {
      await this.#client.prompt(this.#sessionId, text)
      if (this.status === "thinking") this.status = "connected"
    } catch (err: unknown) {
      this.error = `prompt failed: ${err instanceof Error ? err.message : String(err)}`
      this.status = "error"
    }
  }

  // ─── session persistence ─── (slice 8)

  /**
   * Load an existing ACP session by sessionId.
   * Similar to attach() but calls loadSession instead of newSession.
   * After resolution, status === "connected" and the session is ready for sendPrompt.
   */
  loadSession = async (input: {
    sessionId: string
    cwd: string
    cliKind: CliKind
  }): Promise<void> => {
    if (this.status === "connecting" || this.status === "connected") {
      throw new Error(`cannot loadSession in status ${this.status}`)
    }
    this.status = "connecting"
    this.error = null
    this.bubbles = []
    this.#detached = false

    try {
      // 1. Create agent on the BE (same as attach)
      const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
      this.agentId = agentId
      this.cwd = input.cwd

      // 2. Open WS transport + onClose (same as attach)
      const transport = new WsAcpTransport(beWsUrl(`/ws/agent/${agentId}`))
      transport.onClose((code, reason) => {
        if (this.#detached) return
        if (code !== 1000 && code !== 1001) {
          this.error = `WS closed (${code}): ${reason || "no reason"}`
          this.status = "error"
        }
      })
      await transport.waitForOpen()

      // 3. ACP handshake (same as attach)
      this.#client = await createAcpClient(transport, this.#onSessionUpdate)

      // ── loadSession instead of newSession ──
      await this.#client.loadSession({ sessionId: input.sessionId, cwd: input.cwd })
      this.#sessionId = input.sessionId

      // 4. Notify BE (same as attach, best-effort)
      await notifySessionAttached(agentId, this.#sessionId).catch(() => {})

      this.status = "connected"
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.error = `loadSession failed: ${msg}`
      this.status = "error"
      this.#cleanup()
    }
  }

  // ─── recordings ─── (slice 10 will add)

  // ─── private ─────────────────────────────────────

  #cleanup(): void {
    try {
      this.#client?.close()
    } catch {
      // already closed
    }
    this.#client = null
    this.#sessionId = null
    this.agentId = null
  }

  #onSessionUpdate = (notification: SessionNotification): void => {
    // ACP envelope: { sessionId, update: { sessionUpdate, content, messageId, ... } }
    // messageId is on the outer update object (ACP unstable extension).
    const update = notification.update as {
      sessionUpdate?: string
      content?: { type?: string; text?: string }
      messageId?: string | null
    }
    const text = update.content?.type === "text" ? (update.content.text ?? "") : ""
    if (!text) return

    const messageId = update.messageId ?? null

    if (update.sessionUpdate === "agent_message_chunk") {
      this.#appendChunk("message", text, messageId)
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      this.#appendChunk("thought", text, messageId)
    } else if (update.sessionUpdate === "user_message_chunk") {
      // Sent by the agent during loadSession history replay (per ACP spec
      // §session-setup#loading-sessions). Never arrives for live turns —
      // those originate from sendPrompt and we add the optimistic bubble there.
      this.#appendChunk("user", text, messageId)
    }
  }

  #appendChunk(kind: "message" | "thought" | "user", text: string, messageId: string | null): void {
    const last = this.bubbles[this.bubbles.length - 1]
    // Group only when: (a) same kind AND (b) non-null matching messageId.
    // Null/missing messageId always starts a new bubble (per ACP grouping rule).
    const canGroup =
      last !== undefined && last.kind === kind && messageId !== null && last.messageId === messageId

    if (canGroup && last !== undefined) {
      const seg: Segment = { id: crypto.randomUUID(), text }
      // last is MessageBubble | ThoughtBubble | UserBubble — all have segments arrays
      if (last.kind === "message") {
        ;(last as MessageBubble).segments.push(seg)
      } else if (last.kind === "thought") {
        ;(last as ThoughtBubble).segments.push(seg)
      } else if (last.kind === "user") {
        ;(last as UserBubble).segments.push(seg)
      }
    } else {
      const newBubble: MessageBubble | ThoughtBubble | UserBubble =
        kind === "message"
          ? {
              id: crypto.randomUUID(),
              kind: "message",
              messageId,
              createdAt: Date.now(),
              segments: [{ id: crypto.randomUUID(), text }],
            }
          : kind === "thought"
            ? {
                id: crypto.randomUUID(),
                kind: "thought",
                messageId,
                createdAt: Date.now(),
                segments: [{ id: crypto.randomUUID(), text }],
              }
            : {
                id: crypto.randomUUID(),
                kind: "user",
                messageId,
                createdAt: Date.now(),
                segments: [{ id: crypto.randomUUID(), text }],
              }
      this.bubbles.push(newBubble)
    }
  }
}
