/**
 * gemini.ts — Gemini Live adapter (normalization only; no token mint, no config build).
 *
 * Slice: live-contract-gemini, Commit 2.
 * Importable from bun scripts — no $lib, no browser globals in connect path.
 */

import type {
  LiveCommand,
  LiveConnectOpts,
  LiveEvent,
  LiveProvider,
  LiveSession,
} from "@drive-coding/core/voice/live-types"
import { GoogleGenAI } from "@google/genai"
import { base64ToBytes, bytesToBase64 } from "../base64.js"

type GeminiPart = {
  inlineData?: { data?: string }
}

type GeminiMessage = {
  setupComplete?: { sessionId?: string }
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] }
  serverContent?: {
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
    modelTurn?: { parts?: GeminiPart[] }
    interrupted?: boolean
    turnComplete?: boolean
  }
  usageMetadata?: { totalTokenCount?: number; promptTokenCount?: number }
}

/** Maps one Gemini Live frame to zero or more LiveEvents. Exported for unit tests. */
export function normalizeGeminiFrame(msg: GeminiMessage): LiveEvent[] {
  const events: LiveEvent[] = []

  if (msg.setupComplete !== undefined) {
    events.push({ type: "session_started" })
  }

  const inputText = msg.serverContent?.inputTranscription?.text
  if (inputText) {
    events.push({ type: "transcript", role: "user", text: inputText, final: false })
  }

  const outputText = msg.serverContent?.outputTranscription?.text
  if (outputText) {
    events.push({ type: "transcript", role: "assistant", text: outputText, final: false })
  }

  for (const part of msg.serverContent?.modelTurn?.parts ?? []) {
    const b64 = part.inlineData?.data
    if (b64) events.push({ type: "audio", pcm: base64ToBytes(b64) })
  }

  for (const call of msg.toolCall?.functionCalls ?? []) {
    if (!call.id || !call.name) continue
    events.push({
      type: "action",
      id: call.id,
      name: call.name,
      args: call.args ?? {},
    })
  }

  if (msg.serverContent?.interrupted) {
    events.push({ type: "interrupted" })
  }

  if (msg.serverContent?.turnComplete) {
    events.push({ type: "turn_done", role: "assistant" })
  }

  const usage = msg.usageMetadata
  if (usage?.totalTokenCount !== undefined) {
    events.push({
      type: "usage",
      totalTokens: usage.totalTokenCount,
      promptTokens: usage.promptTokenCount ?? 0,
    })
  }

  return events
}

function pcmToBase64(pcm: Uint8Array): string {
  return bytesToBase64(pcm)
}

/**
 * Gemini `sendToolResponse` expects a protobuf `Struct` — a map, not a primitive
 * and not a list. Anything else closes the session, and the wire error names the
 * wrong field, so it reads like a bug in our code rather than in the payload:
 *
 *   close: Invalid JSON payload received. Unknown name "response"
 *          at 'tool_response.function_responses[0]': Proto field is not repeated
 *
 * Measured 2026-08-27: `[{status:"sent"}]` → session dead, 0 frames after.
 * The same call with `{status:"sent"}` → session alive, 41 frames.
 *
 * `Array.isArray` is load-bearing: `typeof [] === "object"`, so a bare
 * `typeof` check lets lists straight through to the failure above.
 */
export function wrapActionResultResponse(result: unknown): unknown {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result
  }
  return { value: result }
}

/** Backstop for the case where neither `onerror` nor `onclose` ever fires. */
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000

export const geminiLive: LiveProvider = {
  id: "gemini-live",
  inputSampleRate: 16_000,
  outputSampleRate: 24_000,
  supportsSilentContext: true,

  async connect(opts: LiveConnectOpts): Promise<LiveSession> {
    const client = new GoogleGenAI({ apiKey: opts.credential })

    // NBug17. `client.live.connect()` resolves on a healthy handshake but is not
    // guaranteed to settle when the socket never comes up: the SDK reports that
    // through `onerror`/`onclose`, which emit our events but do NOT release the
    // promise. A caller that only awaits `connect()` therefore waits forever —
    // and that caller is a driver pressing "start" on a flaky mobile network,
    // with the UI stuck on "connecting…" and no error and no way out.
    //
    // So failure is made to REJECT. A bare timeout would only trade an unbounded
    // hang for a bounded one; what the caller actually needs is to be told that
    // the attempt failed. The timeout below stays as a backstop for the case
    // where neither callback ever fires.
    //
    // The events still fire first (`onEvent` is wired before the await), so an
    // engine that listens for `error`/`closed` keeps working unchanged.
    let settled = false
    let rejectFailure: ((reason: Error) => void) | undefined
    const failure = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject
    })
    const failOnce = (message: string): void => {
      if (settled) return
      settled = true
      rejectFailure?.(new Error(message))
    }

    const timeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    const timer = setTimeout(
      () => failOnce(`live connect timed out after ${timeoutMs}ms`),
      timeoutMs,
    )

    let session: Awaited<ReturnType<typeof client.live.connect>>
    try {
      session = await Promise.race([
        client.live.connect({
          model: opts.model,
          config: opts.providerConfig,
          callbacks: {
            onopen: () => {},
            onmessage: (message) => {
              for (const event of normalizeGeminiFrame(message as GeminiMessage)) {
                opts.onEvent(event)
              }
            },
            onerror: (err: Error) => {
              opts.onEvent({ type: "error", message: String(err?.message ?? err) })
              failOnce(String(err?.message ?? err))
            },
            onclose: (evt: { reason?: string }) => {
              opts.onEvent({ type: "closed", reason: evt?.reason })
              failOnce(evt?.reason ?? "live session closed before it was ready")
            },
          },
        }),
        failure,
      ])
    } finally {
      clearTimeout(timer)
    }
    // Past this point the session is live: later error/close are ordinary events,
    // never rejections, or we would raise an unhandled rejection on normal close.
    settled = true

    return {
      send(command: LiveCommand): void {
        switch (command.type) {
          case "audio":
            session.sendRealtimeInput({
              audio: {
                data: pcmToBase64(command.pcm),
                mimeType: "audio/pcm;rate=16000",
              },
            })
            break
          case "audio_stream_end":
            session.sendRealtimeInput({ audioStreamEnd: true })
            break
          case "context":
            if (command.channel === "silent") {
              session.sendClientContent({
                turns: [{ role: "user", parts: [{ text: command.text }] }],
                turnComplete: false,
              })
            } else {
              session.sendRealtimeInput({ text: command.text })
            }
            break
          case "action_result":
            session.sendToolResponse({
              functionResponses: [
                {
                  id: command.id,
                  name: command.name,
                  response: wrapActionResultResponse(command.result),
                },
              ],
            })
            break
          case "close":
            session.close()
            break
        }
      },
      close(): void {
        session.close()
      },
    }
  },
}
