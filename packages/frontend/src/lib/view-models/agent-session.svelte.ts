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
import type { CliKind } from "@drive-coding/core"
import type {
  Bubble,
  MessageBubble,
  Segment,
  ThoughtBubble,
  UserBubble,
} from "$lib/types/bubble"

export type AgentSessionStatus =
  | "idle"        // no agent yet
  | "connecting"  // creating agent + ACP handshake
  | "connected"   // ready to receive prompts
  | "thinking"    // prompt sent, awaiting agent response
  | "error"

export class AgentSession {
  status = $state<AgentSessionStatus>("idle")
  error = $state<string | null>(null)
  bubbles = $state<Bubble[]>([])
  agentId = $state<string | null>(null)
  cwd = $state<string | null>(null)

  #client: AcpClient | null = null
  #sessionId: string | null = null

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

    try {
      // 1. Create agent on the BE
      const { agentId } = await createAgent({ cwd: input.cwd, cliKind: input.cliKind })
      this.agentId = agentId
      this.cwd = input.cwd

      // 2. Open WS transport
      const proto = location.protocol === "https:" ? "wss:" : "ws:"
      const transport = new WsAcpTransport(`${proto}//${location.host}/ws/agent/${agentId}`)
      transport.onClose((code, reason) => {
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
    this.#cleanup()
    this.status = "idle"
    this.error = null
    this.bubbles = []
  }

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
    }
  }

  #appendChunk(kind: "message" | "thought", text: string, messageId: string | null): void {
    const last = this.bubbles[this.bubbles.length - 1]
    // Group only when: (a) same kind AND (b) non-null matching messageId.
    // Null/missing messageId always starts a new bubble (per ACP grouping rule).
    const canGroup =
      last !== undefined &&
      last.kind === kind &&
      messageId !== null &&
      last.messageId === messageId

    if (canGroup && last !== undefined) {
      const seg: Segment = { id: crypto.randomUUID(), text }
      // last is MessageBubble or ThoughtBubble — both have segments arrays
      if (last.kind === "message") {
        (last as MessageBubble).segments.push(seg)
      } else if (last.kind === "thought") {
        (last as ThoughtBubble).segments.push(seg)
      }
    } else {
      const newBubble: MessageBubble | ThoughtBubble =
        kind === "message"
          ? {
              id: crypto.randomUUID(),
              kind: "message",
              messageId,
              createdAt: Date.now(),
              segments: [{ id: crypto.randomUUID(), text }],
            }
          : {
              id: crypto.randomUUID(),
              kind: "thought",
              messageId,
              createdAt: Date.now(),
              segments: [{ id: crypto.randomUUID(), text }],
            }
      this.bubbles.push(newBubble)
    }
  }
}
