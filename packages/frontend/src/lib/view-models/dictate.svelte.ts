/**
 * Dictate — type-to-input speech capture (append to draft, never sendPrompt).
 * (slice dictate-to-input, C1)
 *
 * State machine: idle → listening → busy → idle
 * Uses Recorder + transcribe; recordingId is discarded (D6).
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import { transcribe } from "../adapters/voice/transcribe"
import { Recorder } from "../engines/recorder"
import type { ComposerDraft } from "./composer-draft.svelte"
import type { Mic } from "./mic.svelte"

export type DictateState = "idle" | "listening" | "busy"

export class Dictate {
  state: DictateState = $state("idle")
  error: MessageKey | null = $state(null)

  readonly #draft: ComposerDraft
  readonly #mic: Mic
  readonly #recorder: Recorder

  constructor(opts: { draft: ComposerDraft; mic: Mic }) {
    this.#draft = opts.draft
    this.#mic = opts.mic
    this.#recorder = new Recorder()
  }

  toggle = async (): Promise<void> => {
    if (this.state === "idle") {
      this.state = "listening"
      this.error = null
      try {
        await this.#recorder.start()
      } catch (e: unknown) {
        this.state = "idle"
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          this.error = "dictate.error.permission"
        } else if (e instanceof DOMException && e.name === "NotFoundError") {
          this.error = "dictate.error.notFound"
        } else {
          this.error = "dictate.error.generic"
        }
        return
      }
      return
    }

    if (this.state === "listening") {
      this.state = "busy"
      let blob: Blob
      try {
        const result = await this.#recorder.stop()
        blob = result.blob
      } catch (e: unknown) {
        this.state = "idle"
        console.warn("[dictate] recorder.stop() failed", e)
        this.error = "dictate.error.generic"
        return
      }

      try {
        const { text } = await transcribe(blob)
        if (text.trim().length > 0) {
          this.#draft.appendDictation(text)
        }
        this.state = "idle"
        this.error = null
      } catch (e: unknown) {
        this.state = "idle"
        console.warn("[dictate] transcribe() failed", e)
        this.error = "dictate.error.transcribe"
      }
      return
    }

    // busy → no-op
  }

  cancel(): void {
    if (this.state === "listening") {
      void this.#recorder.stop().catch(() => {})
      this.state = "idle"
      this.error = null
    }
  }
}
