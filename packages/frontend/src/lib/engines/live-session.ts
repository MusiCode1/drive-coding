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

export type LiveTranscriptEntry = {
  role: "user" | "assistant"
  text: string
  final: boolean
}

type TranscriptHandler = (entry: LiveTranscriptEntry) => void
type ActionHandler = (action: { id: string; name: string; args: Record<string, unknown> }) => void
type StateHandler = (state: LiveSessionState) => void

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
  transcript.push({ ...entry })
}

export class LiveSessionEngine {
  readonly #connector: LiveConnector
  readonly #frames: {
    on(event: "frame", h: (f: Float32Array) => void): () => void
    stop(): Promise<void>
  }
  readonly #connectTimeoutMs: number

  #state: LiveSessionState = "closed"
  readonly transcript: LiveTranscriptEntry[] = []
  #session: LiveSession | null = null
  #unsubFrame: (() => void) | null = null

  readonly #transcriptHandlers = new Set<TranscriptHandler>()
  readonly #actionHandlers = new Set<ActionHandler>()
  readonly #stateHandlers = new Set<StateHandler>()

  constructor(deps: {
    connector: LiveConnector
    frames: { on(event: "frame", h: (f: Float32Array) => void): () => void; stop(): Promise<void> }
    connectTimeoutMs?: number
  }) {
    this.#connector = deps.connector
    this.#frames = deps.frames
    this.#connectTimeoutMs = deps.connectTimeoutMs ?? 20_000
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

    try {
      const { token, model, sessionConfig } = await this.#connector.fetchToken()
      const session = await this.#connector.provider.connect({
        credential: token,
        model,
        providerConfig: sessionConfig,
        connectTimeoutMs: this.#connectTimeoutMs,
        onEvent: (event) => this.#handleEvent(event),
      })
      this.#session = session
      this.#unsubFrame = this.#frames.on("frame", (frame) => {
        const pcm = float32ToInt16LE(frame)
        session.send({ type: "audio", pcm })
      })
      this.#setState("open")
    } catch {
      this.#cleanupSession()
      this.#setState("error")
    }
  }

  close(): void {
    this.#cleanupSession()
    this.#setState("closed")
  }

  #setState(next: LiveSessionState): void {
    this.#state = next
    for (const h of this.#stateHandlers) h(next)
  }

  #cleanupSession(): void {
    this.#unsubFrame?.()
    this.#unsubFrame = null
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
      case "turn_done": {
        const last = this.transcript.at(-1)
        if (last && last.role === event.role) {
          last.final = true
          for (const h of this.#transcriptHandlers) h({ ...last })
        }
        break
      }
      case "error":
        this.#cleanupSession()
        this.#setState("error")
        break
      case "closed":
        this.#cleanupSession()
        this.#setState("closed")
        break
      default:
        break
    }
  }
}
