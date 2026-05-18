/**
 * tts-client.ts — streaming TTS via ElevenLabs (direct fetch through BE proxy).
 *
 * @ai-sdk/elevenlabs doesn't support streaming — use direct fetch.
 * Headers: xi-api-key placeholder — OneCLI injects real key at proxy.
 *
 * ElevenLabs v3 model required for Hebrew (learnings 2026-05-13).
 * Returns ReadableStream<Uint8Array> for MediaSource consumption.
 */

const PROXY_BASE = `${location.protocol}//${location.host}/proxy/elevenlabs`

export interface TtsOptions {
  text: string
  voiceId: string
  modelId?: string
  signal?: AbortSignal
}

export async function synthesizeStreaming(opts: TtsOptions): Promise<ReadableStream<Uint8Array>> {
  // eleven_v3 is the only ElevenLabs model that supports Hebrew (learnings 2026-05-13)
  const modelId = opts.modelId ?? "eleven_v3"

  const response = await fetch(`${PROXY_BASE}/v1/text-to-speech/${opts.voiceId}/stream`, {
    method: "POST",
    headers: {
      "xi-api-key": "browser-placeholder", // OneCLI proxy replaces with real key
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: opts.text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal: opts.signal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`TTS failed: ${response.status} ${body}`)
  }
  if (!response.body) {
    throw new Error("TTS: no body in response")
  }

  return response.body
}
