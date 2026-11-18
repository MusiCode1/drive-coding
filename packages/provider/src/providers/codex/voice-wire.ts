/**
 * voice-wire.ts — maps the provider-agnostic voice contract onto codex-acp, on the NDJSON wire.
 *
 * Toward the agent: `_drive/voice/{start,stop,speak}` requests become codex-acp's
 * `_codex/realtime/{start,stop,appendSpeech}` (ids and results are unchanged).
 *
 * From the agent:
 *  - `_codex/realtime/event` with a final transcript becomes a chat message marked as voice, so
 *    the conversation with the voice shows up in the session like any other message.
 *  - codex-acp reports Codex's thread status in `session_info_update._meta.codex.threadStatus`.
 *    A voice delegation runs as a turn no prompt owns, so nothing else ends it on our side:
 *    the status is mirrored as a generic `state_update` (idle/running) that the reducer knows.
 *
 * Slice: codex-voice-poc.
 */

/** Marks a chat message that was spoken in the voice conversation. */
export const VOICE_MESSAGE_PREFIX = "🎙 "

/** How Codex's answers reach the voice: `commentary` is spoken, `thinking` (codex default) is quiet context. */
const HANDOFF_MODE = "commentary"

const TO_CODEX: Readonly<Record<string, string>> = {
  "_drive/voice/start": "_codex/realtime/start",
  "_drive/voice/stop": "_codex/realtime/stop",
  "_drive/voice/speak": "_codex/realtime/appendSpeech",
  "_drive/voice/listVoices": "_codex/realtime/listVoices",
}

type Json = Record<string, unknown>

export interface CodexVoiceWire {
  /** FE→agent line. Returns it unchanged unless it is a `_drive/voice/*` request. */
  toAgent(line: string): string
  /** agent→FE line. Returns the original line, followed by any synthesized lines. */
  fromAgent(line: string): string[]
}

function parse(line: string): Json | null {
  if (
    !line.includes("_drive/voice/") &&
    !line.includes("_codex/realtime/event") &&
    !line.includes("threadStatus")
  ) {
    return null // cheap pre-filter: the wire carries every frame of the session
  }
  try {
    const v = JSON.parse(line) as unknown
    return typeof v === "object" && v !== null ? (v as Json) : null
  } catch {
    return null
  }
}

function obj(v: unknown): Json | null {
  return typeof v === "object" && v !== null ? (v as Json) : null
}

function sessionUpdateLine(sessionId: string, update: Json): string {
  return JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } })
}

function translateParams(method: string, params: Json): Json {
  if (method === "_drive/voice/start") {
    const { instructions, ...rest } = params
    return {
      ...rest,
      ...(typeof instructions === "string" ? { prompt: instructions } : {}),
      handoffMode: HANDOFF_MODE,
    }
  }
  return params
}

export function createCodexVoiceWire(): CodexVoiceWire {
  const threadIdle = new Map<string, boolean>()
  let voiceMessageSeq = 0

  function stateLine(sessionId: string, idle: boolean): string {
    return sessionUpdateLine(sessionId, {
      sessionUpdate: "state_update",
      state: idle ? "idle" : "running",
    })
  }

  return {
    toAgent(line) {
      const msg = parse(line)
      const method = typeof msg?.method === "string" ? msg.method : null
      const target = method ? TO_CODEX[method] : undefined
      if (!msg || !method || !target) return line
      return JSON.stringify({
        ...msg,
        method: target,
        params: translateParams(method, obj(msg.params) ?? {}),
      })
    },

    fromAgent(line) {
      const msg = parse(line)
      if (!msg) return [line]
      const params = obj(msg.params)

      if (msg.method === "session/update" && params) {
        const sessionId = typeof params.sessionId === "string" ? params.sessionId : null
        const update = obj(params.update)
        const status = obj(obj(obj(update?._meta)?.codex)?.threadStatus)?.type
        if (
          !sessionId ||
          update?.sessionUpdate !== "session_info_update" ||
          typeof status !== "string"
        ) {
          return [line]
        }
        const idle = status === "idle"
        if (threadIdle.get(sessionId) === idle) return [line]
        threadIdle.set(sessionId, idle)
        return [line, stateLine(sessionId, idle)]
      }

      if (msg.method === "_codex/realtime/event" && params) {
        const sessionId = typeof params.sessionId === "string" ? params.sessionId : null
        const inner = obj(params.params)
        if (!sessionId || params.method !== "thread/realtime/transcript/done" || !inner)
          return [line]
        const text = typeof inner.text === "string" ? inner.text.trim() : ""
        const role =
          inner.role === "user" ? "user" : inner.role === "assistant" ? "assistant" : null
        if (!text || !role) return [line]
        voiceMessageSeq += 1
        const out = [
          line,
          sessionUpdateLine(sessionId, {
            sessionUpdate: role === "user" ? "user_message_chunk" : "agent_message_chunk",
            messageId: `voice-${voiceMessageSeq}-${sessionId}`,
            content: { type: "text", text: `${VOICE_MESSAGE_PREFIX}${text}` },
          }),
        ]
        // A voice message on an idle thread must not leave the session looking busy.
        if (threadIdle.get(sessionId) !== false) out.push(stateLine(sessionId, true))
        return out
      }

      return [line]
    },
  }
}
