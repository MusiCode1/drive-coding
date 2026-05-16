import type { AcpTransport, ServerMessage, SessionNotification } from "@drive-coding/core"

export type Subscriber = (msg: ServerMessage) => void

/**
 * AgentSession holds an AcpTransport and a set of WS subscribers.
 * All subscribers receive every broadcast event (multi-tab fan-out).
 */
export type AgentSession = {
  readonly agentId: string
  /** Subscribe to broadcast events. Returns an unsubscribe function. */
  readonly subscribe: (cb: Subscriber) => () => void
  /** Send a prompt to the agent. Broadcasts thinking/chunks/done/error events. */
  readonly sendPrompt: (text: string) => Promise<void>
  /** Cancel in-flight prompt. */
  readonly cancel: () => Promise<void>
  /** Shutdown the transport. */
  readonly shutdown: () => Promise<void>
}

export function createAgentSession(opts: {
  agentId: string
  transport: AcpTransport
}): AgentSession {
  const subscribers = new Set<Subscriber>()

  function broadcast(msg: ServerMessage): void {
    for (const sub of subscribers) {
      try {
        sub(msg)
      } catch (e) {
        console.error("[agent-session] subscriber threw:", e)
      }
    }
  }

  function handleNotification(notification: SessionNotification): void {
    const update = notification.update

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const content = update.content
        if (content.type === "text") {
          broadcast({
            type: "text_chunk",
            kind: "message",
            text: content.text,
          })
        }
        break
      }
      case "agent_thought_chunk": {
        const content = update.content
        if (content.type === "text") {
          broadcast({
            type: "text_chunk",
            kind: "thought",
            text: content.text,
          })
        }
        break
      }
      case "tool_call": {
        broadcast({
          type: "tool_call",
          toolCallId: String(update.toolCallId),
          title: update.title,
        })
        break
      }
      // Other update kinds (plan, usage, etc.) — silent in Slice 4
      default:
        break
    }
  }

  return {
    agentId: opts.agentId,

    subscribe(cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },

    async sendPrompt(text) {
      broadcast({ type: "thinking" })

      try {
        const response = await opts.transport.prompt({ text }, handleNotification)

        broadcast({
          type: "done",
          stopReason: response.stopReason,
        })
      } catch (e) {
        broadcast({
          type: "error",
          code: "PROMPT_FAILED",
          message: e instanceof Error ? e.message : String(e),
        })
      }
    },

    async cancel() {
      await opts.transport.cancel()
    },

    async shutdown() {
      await opts.transport.shutdown()
    },
  }
}
