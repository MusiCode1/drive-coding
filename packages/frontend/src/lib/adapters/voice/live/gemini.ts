/**
 * gemini.ts — Gemini Live adapter (normalization only; no token mint, no config build).
 *
 * Slice: live-contract-gemini, Commit 2.
 * Importable from bun scripts — no $lib, no browser globals in connect path.
 */

import { GoogleGenAI } from "@google/genai"
import type {
  LiveCommand,
  LiveConnectOpts,
  LiveEvent,
  LiveProvider,
  LiveSession,
} from "@drive-coding/core/voice/live-types"
import { base64ToBytes, bytesToBase64 } from "../base64.js"

type GeminiPart = {
  inlineData?: { data?: string }
}

type GeminiMessage = {
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
  if (usage?.totalTokenCount !== undefined && usage.promptTokenCount !== undefined) {
    events.push({
      type: "usage",
      totalTokens: usage.totalTokenCount,
      promptTokens: usage.promptTokenCount,
    })
  }

  return events
}

function pcmToBase64(pcm: Uint8Array): string {
  return bytesToBase64(pcm)
}

export const geminiLive: LiveProvider = {
  id: "gemini-live",
  inputSampleRate: 16_000,
  outputSampleRate: 24_000,
  supportsSilentContext: true,

  async connect(opts: LiveConnectOpts): Promise<LiveSession> {
    const client = new GoogleGenAI({ apiKey: opts.credential })

    const session = await client.live.connect({
      model: opts.model,
      config: opts.providerConfig,
      callbacks: {
        onopen: () => {
          opts.onEvent({ type: "session_started" })
        },
        onmessage: (message) => {
          for (const event of normalizeGeminiFrame(message as GeminiMessage)) {
            opts.onEvent(event)
          }
        },
        onerror: (err: Error) => {
          opts.onEvent({ type: "error", message: String(err?.message ?? err) })
        },
        onclose: (evt: { reason?: string }) => {
          opts.onEvent({ type: "closed", reason: evt?.reason })
        },
      },
    })

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
                  response: command.result,
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
