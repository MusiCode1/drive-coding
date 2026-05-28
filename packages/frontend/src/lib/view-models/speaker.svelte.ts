/**
 * Speaker — the agent's "mouth".
 *
 * Subscribes to AgentSession.bubbles. For every new chunk of a message or
 * thought bubble it:
 *   1. accumulates text into a per-bubble buffer
 *   2. runs `splitIntoSentences` to extract complete sentences
 *   3. enqueues a TTS job per sentence
 *   4. the fetch-loop honours a lookahead of LOOKAHEAD concurrent fetches
 *   5. each completed fetch is handed to `Player` via `AudioStream`
 *
 * Thoughts go through Gemini translation to Hebrew before TTS. Messages are
 * spoken as-is (the agent is already prompted to respond in Hebrew).
 *
 * Slice 2: Speaker holds the voice id as a `const`. Slice 9 will wire it
 * through Settings — same field, just becomes a dynamic getter.
 *
 * Reactivity rules (Svelte 5):
 *   - reads from `session.bubbles[*].segments` are inside the effect and DO
 *     track. That's what makes Speaker re-run when chunks arrive.
 *   - writes to `#bubbleStates` and `#jobs` are plain (non-state) data
 *     structures and don't retrigger. State writes (`state`, `currentSegmentId`)
 *     go through `untrack` defensively (learnings 2026-05-16).
 */

import { splitIntoSentences } from "@drive-coding/core/voice/sentence-boundary"
import { untrack } from "svelte"
import type { AgentSession, AgentSessionStatus } from "./agent-session.svelte"
import { AudioStream } from "../engines/audio-stream"
import { Player } from "../engines/player"
import { synthesizeStreaming } from "../adapters/voice/tts"
import { translate } from "../adapters/voice/translate"

// Slice 2 constants — slice 9 will move voiceId into Settings.
const VOICE_ID = "EXAVITQu4vr4xnSDxMaL" // Sarah, ElevenLabs (learnings 2026-05-13)
const TARGET_LANG = "he" as const
const MIN_CHARS = 20
const MAX_CHARS = 200
const LOOKAHEAD = 2

export type TtsJobStatus = "pending" | "fetching" | "ready" | "error"

export type TtsJob = {
  segmentId: string
  kind: "message" | "thought"
  messageId: string | null
  text: string
  status: TtsJobStatus
  abort: AbortController
}

type BubbleState = {
  processedSegments: number
  buffer: string
}

export class Speaker {
  enabled: boolean = $state(true)

  readonly #session: AgentSession
  readonly #audioStream: AudioStream
  readonly #player: Player

  /**
   * Derived from `#player.state`. Implemented as a getter rather than a
   * `$derived` field so the reference to `#player` is evaluated lazily after
   * the constructor has run (TS doesn't allow forward-referencing private
   * fields from a field initializer). The getter is still tracked: reading
   * `#player.state` inside it pulls in the underlying `$state` dependency.
   */
  get state(): "idle" | "speaking" {
    return this.#player.state === "playing" ? "speaking" : "idle"
  }

  #bubbleStates: Map<string, BubbleState> = new Map()
  #jobs: TtsJob[] = []
  #activeFetches = 0
  #prevStatus: AgentSessionStatus = "idle"

  // Set by constructor — kept so destroy() can stop the effect.
  #disposeEffect: (() => void) | null = null

  constructor(opts: { session: AgentSession }) {
    this.#session = opts.session
    this.#audioStream = new AudioStream()
    this.#player = new Player(this.#audioStream)

    // The single effect that drives everything: reads bubbles + status + enabled.
    // Writes are wrapped in `untrack` (gotcha §6 #5).
    this.#disposeEffect = $effect.root(() => {
      $effect(() => {
        // ── Reads (tracked) ────────────────────────────────────────────
        const status = this.#session.status
        const enabled = this.enabled
        // walk bubbles → reads bubble.kind, bubble.id, bubble.messageId,
        // bubble.segments (and via the segment-count guard, bubble.segments.length)
        const bubbles = this.#session.bubbles
        // Pin reactivity on each bubble's segments.length so a `push` to
        // segments triggers the effect (gotcha §6 #2).
        const _segCounts = bubbles
          .filter((b) => b.kind === "message" || b.kind === "thought")
          .map((b) => (b as { segments: { id: string }[] }).segments.length)
        void _segCounts

        // ── Writes (untracked) ─────────────────────────────────────────
        untrack(() => {
          this.#processBubbles(bubbles, enabled)
          this.#handleStatusTransition(status, enabled)
          this.#prevStatus = status
        })
      })
    })
  }

  /**
   * Toggle voice playback. Disabling clears the queue and stops playback.
   * Re-enabling does NOT replay history — only newly-arriving chunks are spoken.
   */
  toggle(): void {
    this.enabled = !this.enabled
    if (!this.enabled) this.#stopAndClear()
  }

  destroy(): void {
    this.#disposeEffect?.()
    this.#disposeEffect = null
    this.#stopAndClear()
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  #processBubbles(bubbles: AgentSession["bubbles"], enabled: boolean): void {
    for (const bubble of bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue
      const segArr = bubble.segments
      let state = this.#bubbleStates.get(bubble.id)
      if (state === undefined) {
        state = { processedSegments: 0, buffer: "" }
        this.#bubbleStates.set(bubble.id, state)
      }

      if (state.processedSegments >= segArr.length) continue

      const newChunks = segArr
        .slice(state.processedSegments)
        .map((s) => s.text)
        .join("")
      state.processedSegments = segArr.length

      if (!enabled) {
        // Discard — when toggled on later we don't want to spam stale content.
        state.buffer = ""
        continue
      }

      state.buffer += newChunks
      const { sentences, remaining } = splitIntoSentences(state.buffer, {
        minChars: MIN_CHARS,
        maxChars: MAX_CHARS,
      })
      state.buffer = remaining

      for (const sentence of sentences) {
        this.#enqueue(bubble.kind, bubble.messageId, sentence)
      }
    }
    this.#pumpFetchLoop()
  }

  #handleStatusTransition(status: AgentSessionStatus, enabled: boolean): void {
    // Turn ended? Flush every per-bubble buffer as a final segment.
    const justFinished =
      this.#prevStatus === "thinking" && (status === "connected" || status === "error")
    if (justFinished && enabled) {
      for (const [bubbleId, state] of this.#bubbleStates) {
        if (state.buffer.trim().length === 0) continue
        const bubble = this.#session.bubbles.find((b) => b.id === bubbleId)
        if (bubble === undefined) continue
        if (bubble.kind !== "message" && bubble.kind !== "thought") continue
        this.#enqueue(bubble.kind, bubble.messageId, state.buffer.trim())
        state.buffer = ""
      }
      this.#pumpFetchLoop()
    }
  }

  #enqueue(kind: "message" | "thought", messageId: string | null, text: string): void {
    if (text.length === 0) return
    this.#jobs.push({
      segmentId: crypto.randomUUID(),
      kind,
      messageId,
      text,
      status: "pending",
      abort: new AbortController(),
    })
  }

  #pumpFetchLoop(): void {
    while (this.#activeFetches < LOOKAHEAD) {
      const job = this.#jobs.find((j) => j.status === "pending")
      if (job === undefined) break
      job.status = "fetching"
      this.#activeFetches += 1
      void this.#fetchJob(job).finally(() => {
        this.#activeFetches -= 1
        this.#pumpFetchLoop()
      })
    }
  }

  async #fetchJob(job: TtsJob): Promise<void> {
    try {
      let text = job.text
      if (job.kind === "thought") {
        const result = await translate(text, TARGET_LANG, job.abort.signal)
        if (result !== null && result.status === "translated") {
          text = result.text
        }
        // already_in_target or null → keep original text
      }

      if (job.abort.signal.aborted) {
        job.status = "error"
        return
      }

      const stream = await synthesizeStreaming({
        text,
        voiceId: VOICE_ID,
        signal: job.abort.signal,
      })
      await this.#audioStream.prepareSegment(job.segmentId, stream, job.abort)
      this.#player.addSegment(job.segmentId)
      job.status = "ready"
    } catch (e) {
      // MIN-5: skip + continue, don't throw.
      job.status = "error"
      console.warn("TTS job failed, skipping segment", {
        id: job.segmentId,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  #stopAndClear(): void {
    for (const job of this.#jobs) {
      if (job.status === "fetching" || job.status === "pending") {
        try {
          job.abort.abort()
        } catch {
          // already aborted
        }
      }
    }
    this.#jobs = []
    this.#player.stop()
    this.#audioStream.clear()
    // Mark every existing bubble as fully processed so re-enable doesn't replay.
    for (const bubble of this.#session.bubbles) {
      if (bubble.kind !== "message" && bubble.kind !== "thought") continue
      const state = this.#bubbleStates.get(bubble.id) ?? {
        processedSegments: 0,
        buffer: "",
      }
      state.processedSegments = bubble.segments.length
      state.buffer = ""
      this.#bubbleStates.set(bubble.id, state)
    }
  }
}
