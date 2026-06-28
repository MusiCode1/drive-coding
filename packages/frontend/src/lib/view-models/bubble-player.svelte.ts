/**
 * BubblePlayer — VM (entity) להשמעת בועה בודדת.
 *
 * toggle(bubbleId) — לחיצה שנייה על אותה בועה עוצרת.
 * guard: no-op אם session.turnState !== "idle" (לא להשמיע בזמן שהסוכן עונה).
 * user bubble → playUserRecording (דרך <audio>).
 * message/thought → TTS דרך RoutingAudioSink + resolveTts.
 * tool bubble → אין ▶.
 *
 * stop() משמר שני מנגנוני-עצירה:
 *   - #audioEl.pause() → עצירת הקלטת-משתמש (playUserRecording אין לו signal)
 *   - #sink.cancel(#segId) → עצירת TTS (sink + WebAudio)
 *
 * אין $effect — toggle הוא method ישיר (§8.10).
 *
 * ─── V4a-unify (Commit 2) ───
 */

import type { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import type { Bubble } from "$lib/types/bubble"
import { playUserRecording } from "$lib/adapters/voice/play-bubble"
import { resolveTts } from "$lib/adapters/voice/tts-resolve"
import { AudioStream } from "$lib/engines/audio-stream"
import { PcmAudioStream } from "$lib/engines/pcm-audio-stream"
import { RoutingAudioSink } from "$lib/engines/routing-audio-sink"

export class BubblePlayer {
  playingBubbleId: string | null = $state(null)

  readonly #session: AgentSession
  readonly #settings: Settings
  #audioEl: HTMLAudioElement | null = null
  #abortCtrl: AbortController | null = null
  readonly #sink = new RoutingAudioSink(new AudioStream(), new PcmAudioStream())
  #segId: string | null = null

  constructor(opts: { session: AgentSession; settings: Settings }) {
    this.#session = opts.session
    this.#settings = opts.settings
  }

  /**
   * לחיצה שנייה על אותה בועה → עוצר. אחרת מנגן.
   * no-op אם turnState !== "idle" או בועה מסוג tool.
   */
  toggle(bubbleId: string): void {
    // no-op אם הסוכן עדיין עונה
    if (this.#session.turnState !== "idle") return

    // לחיצה שנייה על אותה בועה → עצור
    if (this.playingBubbleId === bubbleId) {
      this.stop()
      return
    }

    // עצור ניגון קודם (אם יש)
    this.stop()

    // מצא את הבועה
    const bubble = this.#session.bubbles.find((b: Bubble) => b.id === bubbleId)
    if (!bubble) return

    // tool bubble — אין ▶
    if (bubble.kind === "tool") return

    this.playingBubbleId = bubbleId
    this.#abortCtrl = new AbortController()
    const abortCtrl = this.#abortCtrl

    // צור <audio> חד-פעמי — נשאר לענף user-recording
    const audioEl = new Audio()
    this.#audioEl = audioEl

    const cleanup = () => {
      this.playingBubbleId = null
      this.#audioEl = null
      this.#abortCtrl = null
      this.#segId = null
    }

    if (bubble.kind === "user") {
      const recordingId = bubble.recordingId
      if (!recordingId) {
        cleanup()
        return
      }
      void playUserRecording(recordingId, audioEl).then(cleanup).catch(cleanup)
    } else {
      // message / thought — TTS דרך RoutingAudioSink + resolveTts
      const text = bubble.segments.map((s) => s.text).join("")
      if (!text.trim()) {
        cleanup()
        return
      }
      const { provider, voiceId, modelId } = resolveTts(
        this.#settings.ttsProvider,
        this.#settings.voiceId,
      )
      this.#segId = bubbleId
      const run = async () => {
        const stream = await provider.synthesize({ text, voiceId, modelId, signal: abortCtrl.signal })
        await this.#sink.prepareSegment(bubbleId, stream, abortCtrl, { format: provider.format })
        await this.#sink.play(bubbleId)
      }
      void run().then(cleanup).catch(cleanup)
    }
  }

  /** עוצר כל ניגון פעיל. משמר שני מנגנוני-עצירה: abort + audioEl.pause() + sink.cancel(). */
  stop(): void {
    if (this.#abortCtrl) {
      this.#abortCtrl.abort()
      this.#abortCtrl = null
    }
    // ענף TTS: עצור דרך sink (WebAudio + PCM)
    if (this.#segId) {
      this.#sink.cancel(this.#segId)
      this.#segId = null
    }
    // ענף user-recording: <audio>.pause() — playUserRecording אין לו signal
    if (this.#audioEl) {
      try {
        this.#audioEl.pause()
      } catch {
        // כבר עצור
      }
      this.#audioEl = null
    }
    this.playingBubbleId = null
  }
}
