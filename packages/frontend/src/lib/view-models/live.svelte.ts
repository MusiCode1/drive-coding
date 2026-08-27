/**
 * Live — view-model for Gemini Live secretary session.
 *
 * Composes adapter (fetchLiveToken) + provider (geminiLive) → LiveSessionEngine.
 *
 * Slice: live-ears, Commit 5.
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import { geminiLive } from "../adapters/voice/live/gemini"
import { fetchLiveToken } from "../adapters/voice/live-token"
import {
  LiveSessionEngine,
  type LiveSessionState,
  type LiveTranscriptEntry,
} from "../engines/live-session"
import { MicFrames } from "../engines/mic-frames"
import type { Mic } from "./mic.svelte"

export type { LiveSessionState, LiveTranscriptEntry }

export class Live {
  readonly #mic: Mic
  readonly #engine: LiveSessionEngine
  readonly #frames: MicFrames

  state: LiveSessionState = $state("closed")
  transcript: LiveTranscriptEntry[] = $state([])
  error: MessageKey | null = $state(null)

  constructor(opts: { mic: Mic; language?: "he" | "en"; voiceName?: string }) {
    this.#mic = opts.mic
    this.#frames = new MicFrames()
    this.#engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => {
          const result = await fetchLiveToken({
            language: opts.language,
            voiceName: opts.voiceName,
          })
          return {
            token: result.token,
            model: result.model,
            sessionConfig: result.sessionConfig,
          }
        },
        provider: geminiLive,
      },
      frames: this.#frames,
    })

    this.#engine.on("state", (s) => {
      this.state = s
      if (s === "open") this.error = null
    })
    this.#engine.on("transcript", () => {
      this.transcript = [...this.#engine.transcript]
    })
  }

  get isOpen(): boolean {
    return this.state === "open" || this.state === "connecting"
  }

  /** false while push-to-talk is active (§4.3 mutual exclusion). */
  get canOpen(): boolean {
    return this.#mic.state === "idle" && this.state !== "connecting"
  }

  async toggle(): Promise<void> {
    if (this.isOpen) {
      this.#engine.close()
      return
    }
    if (!this.canOpen) return

    this.error = null
    try {
      await this.#frames.start()
      await this.#engine.open()
      if (this.state === "error") {
        this.error = "live.error.connect"
      }
    } catch (e: unknown) {
      this.error =
        e instanceof Error && e.message === "live.token.noApiKey"
          ? "live.error.noApiKey"
          : "live.error.connect"
      this.#engine.close()
    }
  }
}
