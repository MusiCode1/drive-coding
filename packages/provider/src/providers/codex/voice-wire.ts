/**
 * voice-wire.ts — maps the provider-agnostic voice contract onto codex-acp, on the NDJSON wire.
 *
 * Toward the agent: `_drive/voice/*` requests become codex-acp's `_codex/realtime/*`
 * (ids and results are unchanged).
 *
 * From the agent:
 *  - codex-acp marks the voice conversation's chat messages in `_meta.codex.realtime` (speech of the
 *    user or the voice, and handoffs to Codex — live and in replayed history). The mark is moved to
 *    the generic `_meta["_drive/voice"]`, which the client renders as a distinct message type.
 *  - codex-acp reports Codex's thread status in `session_info_update._meta.codex.threadStatus`.
 *    A voice delegation runs as a turn no prompt owns, so nothing else ends it on our side:
 *    the status is mirrored as a generic `state_update` (idle/running) that the reducer knows.
 *
 * Slice: codex-voice-poc.
 */

/** Generic mark of a voice-conversation message: `{kind:"speech", role}` or `{kind:"handoff", transcript?}`. */
export const VOICE_META_KEY = "_drive/voice"

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
  /** agent→FE line. Returns the (possibly rewritten) line, followed by any synthesized lines. */
  fromAgent(line: string): string[]
}

function parse(line: string): Json | null {
  // cheap pre-filter: the wire carries every frame of the session
  if (
    !line.includes("_drive/voice/") &&
    !line.includes('"realtime"') &&
    !line.includes("threadStatus")
  ) {
    return null
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

/** `_meta` with `codex.realtime` moved to `_drive/voice` (other codex keys kept). */
function voiceMeta(meta: Json, codex: Json, realtime: Json): Json {
  const { realtime: _realtime, ...codexRest } = codex
  const { codex: _codex, ...metaRest } = meta
  return {
    ...metaRest,
    ...(Object.keys(codexRest).length > 0 ? { codex: codexRest } : {}),
    [VOICE_META_KEY]: realtime,
  }
}

export function createCodexVoiceWire(): CodexVoiceWire {
  const threadIdle = new Map<string, boolean>()

  function stateLine(sessionId: string, idle: boolean): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "state_update", state: idle ? "idle" : "running" },
      },
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
      const params = obj(msg?.params)
      if (msg?.method !== "session/update" || !params) return [line]
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : null
      const update = obj(params.update)
      const meta = obj(update?._meta)
      const codex = obj(meta?.codex)
      if (!sessionId || !update || !meta || !codex) return [line]

      const realtime = obj(codex.realtime)
      if (realtime) {
        const rewritten = { ...update, _meta: voiceMeta(meta, codex, realtime) }
        const out = [JSON.stringify({ ...msg, params: { ...params, update: rewritten } })]
        // The voice speaks between Codex's turns: its message on an idle thread must not leave the
        // session looking busy.
        if (update.sessionUpdate === "agent_message_chunk" && threadIdle.get(sessionId) !== false) {
          out.push(stateLine(sessionId, true))
        }
        return out
      }

      const status = obj(codex.threadStatus)?.type
      if (update.sessionUpdate !== "session_info_update" || typeof status !== "string")
        return [line]
      const idle = status === "idle"
      if (threadIdle.get(sessionId) === idle) return [line]
      threadIdle.set(sessionId, idle)
      return [line, stateLine(sessionId, idle)]
    },
  }
}
