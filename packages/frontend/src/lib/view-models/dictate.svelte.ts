/**
 * Dictate — type-to-input speech capture (append to draft only; never sends to agent).
 * (slice dictate-to-input, C1; finishListening — slice dictate-to-input-polish, C0)
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

export type FinishListeningResult =
  | { ok: true; text: string }
  | { ok: false; error: MessageKey }

export class Dictate {
  state: DictateState = $state("idle")
  error: MessageKey | null = $state(null)

  readonly #draft: ComposerDraft
  readonly #mic: Mic
  readonly #recorder: Recorder
  #inFlight: Promise<FinishListeningResult> | null = null

  constructor(opts: { draft: ComposerDraft; mic: Mic }) {
    this.#draft = opts.draft
    this.#mic = opts.mic
    this.#recorder = new Recorder()
  }

  finishListening = (): Promise<FinishListeningResult> => {
    if (this.state === "idle") {
      return Promise.resolve({ ok: true, text: "" })
    }
    if (this.state === "busy" && !this.#inFlight) {
      return Promise.resolve({ ok: false, error: "dictate.error.generic" })
    }
    if (this.#inFlight) {
      return this.#inFlight
    }
    if (this.state === "listening") {
      return this.#runTranscribe()
    }
    return Promise.resolve({ ok: false, error: "dictate.error.generic" })
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
      const result = await this.#runTranscribe()
      if (result.ok && result.text.trim().length > 0) {
        this.#draft.appendDictation(result.text)
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

  #runTranscribe(): Promise<FinishListeningResult> {
    if (!this.#inFlight) {
      this.#inFlight = this.#transcribeBlob().finally(() => {
        this.#inFlight = null
      })
    }
    return this.#inFlight
  }

  async #transcribeBlob(): Promise<FinishListeningResult> {
    this.state = "busy"
    let blob: Blob
    try {
      const result = await this.#recorder.stop()
      blob = result.blob
    } catch (e: unknown) {
      this.state = "idle"
      console.warn("[dictate] recorder.stop() failed", e)
      this.error = "dictate.error.generic"
      return { ok: false, error: "dictate.error.generic" }
    }

    try {
      const { text } = await transcribe(blob)
      this.state = "idle"
      this.error = null
      return { ok: true, text: text.trim().length > 0 ? text : "" }
    } catch (e: unknown) {
      this.state = "idle"
      console.warn("[dictate] transcribe() failed", e)
      this.error = "dictate.error.transcribe"
      return { ok: false, error: "dictate.error.transcribe" }
    }
  }
}
