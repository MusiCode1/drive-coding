/**
 * agent-voice.ts — the agent's own realtime voice front-end: `_drive/voice/*` calls (adapters layer).
 *
 * Provider-agnostic: the contract lives in `@drive-coding/provider/extensions` and a provider that
 * implements it declares `capabilities.voice`. The calls go through the generic ext RPC on the
 * backend (`POST /api/agents/:id/rpc`, `_drive/ext`), so they work for any session view.
 *
 * Also persists the "use the agent's native Live" preference (per device).
 *
 * Slice: codex-voice-poc.
 */

import { RPC_METHODS } from "@drive-coding/core/session"
import {
  type ExtMethodName,
  parseExtParams,
  parseExtResult,
} from "@drive-coding/provider/extensions"
import { beUrl } from "$lib/util/be-url.js"

/** start waits for the provider's SDP answer (codex adapter timeout: 30s). */
const START_WAIT_MS = 40_000
const SHORT_WAIT_MS = 10_000
const NATIVE_PREF_KEY = "dc.liveNativeVoice"
const VOICE_PREF_KEY = "dc.liveNativeVoice.voice"

type RpcBody = { ok?: boolean; timedOut?: boolean; result?: unknown; error?: unknown }

async function voiceRpc(
  agentId: string,
  method: ExtMethodName,
  params: Record<string, unknown>,
  waitMs: number,
): Promise<unknown> {
  const validated = parseExtParams(method, params)
  const url = `${beUrl("").replace(/\/$/, "")}/api/agents/${encodeURIComponent(agentId)}/rpc`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: RPC_METHODS.extMethod,
      params: { method, params: validated },
      waitMs,
    }),
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
  return parseExtResult(method, body.result)
}

/** Negotiates the WebRTC call on the agent's own session; returns the SDP answer. */
export async function startAgentVoice(
  agentId: string,
  sessionId: string,
  sdp: string,
  instructions: string,
  voice?: string,
): Promise<string> {
  const params = { sessionId, sdp, instructions, ...(voice ? { voice } : {}) }
  const result = await voiceRpc(agentId, "_drive/voice/start", params, START_WAIT_MS)
  return (result as { sdp: string }).sdp
}

/** Voices the agent's voice can use, and the one it picks when none is chosen. */
export async function listAgentVoices(
  agentId: string,
  sessionId: string,
): Promise<{ voices: string[]; default: string }> {
  const result = await voiceRpc(agentId, "_drive/voice/listVoices", { sessionId }, SHORT_WAIT_MS)
  return result as { voices: string[]; default: string }
}

export async function stopAgentVoice(agentId: string, sessionId: string): Promise<void> {
  await voiceRpc(agentId, "_drive/voice/stop", { sessionId }, SHORT_WAIT_MS)
}

/** Makes the voice say something now. */
export async function speakAgentVoice(
  agentId: string,
  sessionId: string,
  text: string,
): Promise<void> {
  await voiceRpc(agentId, "_drive/voice/speak", { sessionId, text }, SHORT_WAIT_MS)
}

export function loadNativeVoicePref(): boolean {
  try {
    return globalThis.localStorage?.getItem(NATIVE_PREF_KEY) === "1"
  } catch {
    return false
  }
}

export function saveNativeVoicePref(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(NATIVE_PREF_KEY, on ? "1" : "0")
  } catch {
    // storage unavailable (private mode): the choice lasts for this page only
  }
}

export function loadVoicePref(): string | null {
  try {
    return globalThis.localStorage?.getItem(VOICE_PREF_KEY) || null
  } catch {
    return null
  }
}

export function saveVoicePref(voice: string): void {
  try {
    globalThis.localStorage?.setItem(VOICE_PREF_KEY, voice)
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}
