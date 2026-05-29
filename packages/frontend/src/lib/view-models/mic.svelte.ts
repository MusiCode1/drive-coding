/**
 * Mic — the user's "ear".
 *
 * Single toggle() entry point driven by a MicButton component.
 * State machine: idle → recording → transcribing → idle
 *
 * On successful transcription, sends the text to AgentSession.sendPrompt().
 * recordingId is passed through (slice 10 will wire up the real BE endpoint;
 * for now it's always "").
 *
 * error stores a MessageKey so the component can translate it via t().
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import type { AgentSession } from "./agent-session.svelte"
import { Recorder } from "../engines/recorder"
import { transcribe } from "../adapters/voice/transcribe"

export type MicState = "idle" | "recording" | "transcribing"

export class Mic {
  state: MicState = $state("idle")
  error: MessageKey | null = $state(null)

  readonly #session: AgentSession
  readonly #recorder: Recorder

  constructor(opts: { session: AgentSession }) {
    this.#session = opts.session
    this.#recorder = new Recorder()
  }

  /**
   * Single entry point — the MicButton calls this. Behaves based on state:
   *   idle        → start recording
   *   recording   → stop, transcribe, send prompt
   *   transcribing → no-op (button disabled)
   */
  toggle = async (): Promise<void> => {
    if (this.state === "idle") {
      this.state = "recording"
      this.error = null
      try {
        await this.#recorder.start()
      } catch (e: unknown) {
        this.state = "idle"
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          this.error = "mic.error.permission"
        } else if (e instanceof DOMException && e.name === "NotFoundError") {
          this.error = "mic.error.notFound"
        } else {
          this.error = "mic.error.generic"
        }
        return
      }
      return
    }

    if (this.state === "recording") {
      this.state = "transcribing"
      let blob: Blob
      try {
        const result = await this.#recorder.stop()
        blob = result.blob
      } catch (e: unknown) {
        this.state = "idle"
        console.warn("[mic] recorder.stop() failed", e)
        this.error = "mic.error.generic"
        return
      }

      let text: string
      let recordingId: string
      try {
        const result = await transcribe(blob)
        text = result.text
        recordingId = result.recordingId
      } catch (e: unknown) {
        this.state = "idle"
        console.warn("[mic] transcribe() failed", e)
        this.error = "mic.error.transcribe"
        return
      }

      if (text.trim().length > 0) {
        void this.#session.sendPrompt(text, { recordingId })
      }
      this.state = "idle"
      return
    }

    // transcribing → no-op
  }

  /**
   * Cancel mid-recording. Called by VoiceMode.cancel() (slice 7 will also
   * wire a cancel button). Stops the recorder without sending a prompt.
   */
  cancel(): void {
    if (this.state === "recording") {
      // Stop the recorder without processing the result
      void this.#recorder.stop().catch(() => {})
      this.state = "idle"
      this.error = null
    }
    // transcribing: can't cancel an in-flight Gemini request in this MVP.
    // state will naturally return to idle after transcribe() resolves/rejects.
  }
}
