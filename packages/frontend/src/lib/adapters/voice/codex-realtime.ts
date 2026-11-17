/**
 * codex-realtime.ts — RPC calls for the Codex voice front-end (adapters layer).
 *
 * The codex-acp adapter exposes `_codex/realtime/{start,stop,appendSpeech}`. They reach it through
 * the generic `extMethod` RPC on the backend (`POST /api/agents/:id/rpc`), so this works for any
 * session view without going through AgentSession.
 *
 * Slice: codex-voice-poc.
 */

import { RPC_METHODS } from "@drive-coding/core/session"
import { beUrl } from "$lib/util/be-url.js"

/** start waits for app-server's SDP answer (adapter timeout: 30s). */
const START_WAIT_MS = 40_000
const SHORT_WAIT_MS = 10_000

type RpcBody = { ok?: boolean; timedOut?: boolean; result?: unknown; error?: unknown }

async function extRpc(
  agentId: string,
  method: string,
  params: Record<string, unknown>,
  waitMs: number,
): Promise<unknown> {
  const url = `${beUrl("").replace(/\/$/, "")}/api/agents/${encodeURIComponent(agentId)}/rpc`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: RPC_METHODS.extMethod, params: { method, params }, waitMs }),
  })
  let body: RpcBody = {}
  try {
    body = (await res.json()) as RpcBody
  } catch {
    // non-JSON body: fall through to the status check
  }
  if (!res.ok || body.ok === false) {
    const detail = typeof body.error === "string" ? body.error : `HTTP ${res.status}`
    throw new Error(`${method}: ${detail}`)
  }
  if (body.timedOut) throw new Error(`${method}: timed out`)
  return body.result
}

/** Negotiates the WebRTC call on the session's own Codex thread; returns the SDP answer. */
export async function startCodexVoice(
  agentId: string,
  sessionId: string,
  sdp: string,
  prompt: string,
): Promise<string> {
  const result = await extRpc(
    agentId,
    "_codex/realtime/start",
    { sessionId, sdp, prompt },
    START_WAIT_MS,
  )
  const answer = (result as { sdp?: unknown } | undefined)?.sdp
  if (typeof answer !== "string" || answer.length === 0) {
    throw new Error("_codex/realtime/start: no SDP answer")
  }
  return answer
}

export async function stopCodexVoice(agentId: string, sessionId: string): Promise<void> {
  await extRpc(agentId, "_codex/realtime/stop", { sessionId }, SHORT_WAIT_MS)
}

/** Makes the voice say something now (app-server `thread/realtime/appendSpeech`). */
export async function speakCodexVoice(
  agentId: string,
  sessionId: string,
  text: string,
): Promise<void> {
  await extRpc(agentId, "_codex/realtime/appendSpeech", { sessionId, text }, SHORT_WAIT_MS)
}
