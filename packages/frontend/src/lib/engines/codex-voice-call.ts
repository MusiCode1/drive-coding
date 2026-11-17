/**
 * codex-voice-call.ts — owns one WebRTC voice call with Codex's realtime front-end (engines layer).
 *
 * The browser holds the media: mic track out, model audio in, plus the `oai-events` data channel
 * that carries transcripts and delegation events. The SDP answer comes from `negotiate`, which in
 * production goes through the backend to codex-acp (`_codex/realtime/start`).
 *
 * Slice: codex-voice-poc.
 */

export type CodexVoiceState = "connecting" | "live" | "closed"

export type CodexVoiceEvent =
  | { type: "state"; state: CodexVoiceState }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "delegation"; text: string }
  | { type: "error"; message: string }

export interface CodexVoiceCall {
  stop(): void
}

export interface CodexVoiceCallOptions {
  negotiate(offerSdp: string): Promise<string>
  onEvent(event: CodexVoiceEvent): void
}

type DataChannelEvent = {
  type?: string
  turn?: { role?: string; transcript?: string }
  item?: { content?: Array<{ type?: string; text?: string }> }
  message?: string
  error?: { message?: string }
}

/** Maps one data-channel event (GPT-Live "Frameless Bidi" shape) to what the UI needs. */
export function mapDataChannelEvent(raw: string): CodexVoiceEvent | null {
  let event: DataChannelEvent
  try {
    event = JSON.parse(raw) as DataChannelEvent
  } catch {
    return null
  }
  if (event.type === "turn.done") {
    const role = event.turn?.role
    const text = event.turn?.transcript?.trim() ?? ""
    if ((role === "user" || role === "assistant") && text) return { type: "transcript", role, text }
    return null
  }
  if (event.type === "delegation.created") {
    const text = (event.item?.content ?? [])
      .map((part) => (part.type === "input_text" ? (part.text ?? "") : ""))
      .join("")
      .trim()
    return text ? { type: "delegation", text } : null
  }
  if (event.type === "error") {
    return { type: "error", message: event.error?.message ?? event.message ?? "unknown error" }
  }
  return null
}

export async function startCodexVoiceCall(opts: CodexVoiceCallOptions): Promise<CodexVoiceCall> {
  opts.onEvent({ type: "state", state: "connecting" })
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const pc = new RTCPeerConnection()
  const audio = new Audio()
  audio.autoplay = true
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    pc.close()
    for (const track of stream.getTracks()) track.stop()
    audio.srcObject = null
    opts.onEvent({ type: "state", state: "closed" })
  }

  try {
    for (const track of stream.getTracks()) pc.addTrack(track, stream)
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? null
      void audio.play().catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") opts.onEvent({ type: "state", state: "live" })
      if (pc.connectionState === "failed") {
        opts.onEvent({ type: "error", message: "WebRTC connection failed" })
        stop()
      }
    }
    const channel = pc.createDataChannel("oai-events")
    channel.onmessage = (e) => {
      const mapped = mapDataChannelEvent(String(e.data))
      if (mapped) opts.onEvent(mapped)
    }
    await pc.setLocalDescription(await pc.createOffer())
    const answer = await opts.negotiate(pc.localDescription?.sdp ?? "")
    if (stopped) return { stop }
    await pc.setRemoteDescription({ type: "answer", sdp: answer })
  } catch (err) {
    stop()
    throw err
  }
  return { stop }
}
