/**
 * live-session.ts — Live session engine (provider-agnostic, no adapters).
 *
 * Slice: live-ears, Commit 4.
 */

import type { LiveEvent, LiveProvider, LiveSession } from "@drive-coding/core/voice/live-types"
import { float32ToInt16LE } from "@drive-coding/core/voice/pcm"

export type LiveConnector = {
  fetchToken(): Promise<{ token: string; model: string; sessionConfig: Record<string, unknown> }>
  provider: LiveProvider
}

export type LiveSessionState = "closed" | "connecting" | "open" | "error"

export type LiveSpeechFilter = {
  ingest(frame: Float32Array): readonly Float32Array[] | Promise<readonly Float32Array[]>
  reset(): void
  load?(): Promise<void>
}

export type LiveTranscriptEntry = {
  /**
   * Stable identity for keyed rendering.
   *
   * F1: the view keyed on `role + text`, which is NOT unique — two consecutive
   * partial chunks can carry the same role and the same text, and Svelte 5.55
   * throws on duplicate keys **in production too**, so the crash lands on the
   * user rather than on us. Identity belongs to the entry, not to its content.
   */
  id: number
  role: "user" | "assistant"
  text: string
  final: boolean
}

type TranscriptHandler = (entry: LiveTranscriptEntry) => void
type ActionHandler = (action: { id: string; name: string; args: Record<string, unknown> }) => void
type StateHandler = (state: LiveSessionState) => void

let nextTranscriptId = 0

function appendTranscript(
  transcript: LiveTranscriptEntry[],
  entry: { role: "user" | "assistant"; text: string; final: boolean },
): void {
  const last = transcript.at(-1)
  if (last && last.role === entry.role && !last.final) {
    last.text += entry.text
    last.final = entry.final
    return
  }
  transcript.push({ ...entry, id: nextTranscriptId++ })
}

export class LiveSessionEngine {
  readonly #connector: LiveConnector
  readonly #frames: {
    on(event: "frame", h: (f: Float32Array) => void): () => void
    stop(): Promise<void>
  }
  readonly #connectTimeoutMs: number
  readonly #audioSink?: { enqueue(pcm: Uint8Array): void; stop(): void }
  readonly #speechFilter?: LiveSpeechFilter

  #state: LiveSessionState = "closed"
  #paused = false
  readonly transcript: LiveTranscriptEntry[] = []
  /** F2 — bumped by close(); guards every resumption point inside open(). */
  #openEpoch = 0
  #session: LiveSession | null = null
  #unsubFrame: (() => void) | null = null

  readonly #transcriptHandlers = new Set<TranscriptHandler>()
  readonly #actionHandlers = new Set<ActionHandler>()
  readonly #stateHandlers = new Set<StateHandler>()

  constructor(deps: {
    connector: LiveConnector
    frames: { on(event: "frame", h: (f: Float32Array) => void): () => void; stop(): Promise<void> }
    connectTimeoutMs?: number
    audioSink?: { enqueue(pcm: Uint8Array): void; stop(): void }
    speechFilter?: LiveSpeechFilter
  }) {
    this.#connector = deps.connector
    this.#frames = deps.frames
    this.#connectTimeoutMs = deps.connectTimeoutMs ?? 20_000
    this.#audioSink = deps.audioSink
    this.#speechFilter = deps.speechFilter
  }

  get state(): LiveSessionState {
    return this.#state
  }

  on(event: "transcript", h: TranscriptHandler): () => void
  on(event: "action", h: ActionHandler): () => void
  on(event: "state", h: StateHandler): () => void
  on(
    event: "transcript" | "action" | "state",
    h: TranscriptHandler | ActionHandler | StateHandler,
  ): () => void {
    if (event === "transcript") {
      this.#transcriptHandlers.add(h as TranscriptHandler)
      return () => this.#transcriptHandlers.delete(h as TranscriptHandler)
    }
    if (event === "action") {
      this.#actionHandlers.add(h as ActionHandler)
      return () => this.#actionHandlers.delete(h as ActionHandler)
    }
    this.#stateHandlers.add(h as StateHandler)
    return () => this.#stateHandlers.delete(h as StateHandler)
  }

  async open(): Promise<void> {
    if (this.#state === "connecting" || this.#state === "open") return
    this.#setState("connecting")
    this.transcript.length = 0

    // F2: `open()` awaits twice (token, then connect). A `close()` landing in
    // either gap used to be silently discarded — it flipped state to "closed",
    // but this in-flight call carried on and set "open" afterwards, so the user
    // saw a session they had already closed, `session.close()` was never called,
    // and a live Gemini session stayed up burning the mic and the budget.
    //
    // This is the symmetric hole to NBug17: that one was "connect never
    // settles", this one is "close during connect is ignored". Both are races
    // around the connection lifecycle.
    //
    // The epoch is the whole fix: `close()` bumps it, and every resumption point
    // after an await checks whether it is still the current attempt.
    const epoch = ++this.#openEpoch

    try {
      const { token, model, sessionConfig } = await this.#connector.fetchToken()
      if (epoch !== this.#openEpoch) return

      const session = await this.#connector.provider.connect({
        credential: token,
        model,
        providerConfig: sessionConfig,
        connectTimeoutMs: this.#connectTimeoutMs,
        onEvent: (event) => this.#handleEvent(event),
      })

      if (epoch !== this.#openEpoch) {
        // Closed while the socket was coming up: shut the session we just
        // opened, and leave state alone — `close()` already set it.
        try {
          session.close()
        } catch {
          /* already gone */
        }
        return
      }

      this.#session = session
      this.#unsubFrame = this.#frames.on("frame", (frame) => {
        this.#onFrame(frame)
      })
      this.#setState("open")
    } catch {
      if (epoch !== this.#openEpoch) return
      this.#cleanupSession()
      this.#setState("error")
    }
  }

  close(): void {
    this.#openEpoch++
    this.#paused = false
    this.#cleanupSession()
    this.#setState("closed")
  }

  /** Pause mic forwarding without stopping capture or closing the socket. */
  setPaused(paused: boolean): void {
    this.#paused = paused
  }

  #onFrame(frame: Float32Array): void {
    if (this.#paused) return
    const session = this.#session
    if (!session) return

    if (this.#speechFilter) {
      void this.#forwardFilteredFrame(frame, session)
      return
    }

    session.send({ type: "audio", pcm: float32ToInt16LE(frame) })
  }

  async #forwardFilteredFrame(frame: Float32Array, session: LiveSession): Promise<void> {
    const batches = await this.#speechFilter!.ingest(frame)
    if (this.#paused || this.#session !== session) return
    for (const chunk of batches) {
      session.send({ type: "audio", pcm: float32ToInt16LE(chunk) })
    }
  }

  /** Immediate tool response — does not wait for agent turn (§B.2). */
  sendActionResult(id: string, name: string, result: unknown): void {
    this.#session?.send({ type: "action_result", id, name, result })
  }

  sendContext(text: string, channel: "speakable" | "silent"): void {
    this.#session?.send({ type: "context", text, channel })
  }

  #setState(next: LiveSessionState): void {
    this.#state = next
    for (const h of this.#stateHandlers) h(next)
  }

  #cleanupSession(): void {
    this.#unsubFrame?.()
    this.#unsubFrame = null
    this.#audioSink?.stop()
    this.#session?.close()
    this.#session = null
    void this.#frames.stop()
  }

  #handleEvent(event: LiveEvent): void {
    switch (event.type) {
      case "transcript": {
        const entry = { role: event.role, text: event.text, final: event.final }
        appendTranscript(this.transcript, entry)
        for (const h of this.#transcriptHandlers) h(entry)
        break
      }
      case "action":
        for (const h of this.#actionHandlers) {
          h({ id: event.id, name: event.name, args: event.args })
        }
        break
      case "audio":
        this.#audioSink?.enqueue(event.pcm)
        break
      case "interrupted":
        this.#audioSink?.stop()
        break
      case "turn_done": {
        const last = this.transcript.at(-1)
        if (last && last.role === event.role) {
          last.final = true
          for (const h of this.#transcriptHandlers) h({ ...last })
        }
        break
      }
      // Both terminal branches end the attempt, so both must invalidate any
      // `open()` still in flight — exactly as `close()` does. Without the bump
      // this is asymmetric with `close()`, and it is unreachable today only by
      // ACCIDENT: `geminiLive` wires `onerror`/`onclose` to `failOnce()`, so the
      // pending `connect()` rejects on the same microtask turn and the window
      // shuts before anyone can slip through. Timing order is not a guarantee —
      // a provider that emits `error` without rejecting would reopen the hole.
      //
      // Third instance of this family: NBug17 (connect never settles), F2
      // (close during connect ignored), and now this one.
      case "error":
        this.#openEpoch++
        this.#cleanupSession()
        this.#setState("error")
        break
      case "closed":
        this.#openEpoch++
        this.#cleanupSession()
        this.#setState("closed")
        break
      default:
        break
    }
  }
}
