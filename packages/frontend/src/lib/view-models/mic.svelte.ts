/**
 * Mic — "האוזן" של המשתמש.
 *
 * נקודת כניסה (entry point) יחידה toggle() שמונעת על ידי רכיב ה-MicButton.
 * מכונת מצבים: idle → requesting → recording → transcribing → idle
 *
 * `requesting` = ממתינים ל-getUserMedia (דיאלוג הרשאה *או* פתיחת סטרים).
 * `awaitingPermissionDialog` = true רק כש-Permissions API אומר `prompt`
 * (מסביר UI של «ממתינים לאישור» — לא כשההרשאה כבר ניתנה).
 * עוברים ל-recording רק אחרי ש-getUserMedia הצליח.
 *
 * ─── slice voice-pending-persistence: IndexedDB pending + retry/dismiss/hydrate ───
 * ─── slice mic-permission-indication: requesting + hint לפני אישור ───
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import type { CuesEngine } from "../engines/cues"
import type { AgentSession } from "./agent-session.svelte"
import { Recorder } from "../engines/recorder"
import { transcribe } from "../adapters/voice/transcribe"
import { probeMicPermission } from "../util/mic-permission"

export type MicState = "idle" | "requesting" | "recording" | "transcribing"

type MicTranscribeContext = {
  transcribe: (blob: Blob) => Promise<{ text: string; recordingId: string }>
  onSend?: (text: string, recordingId: string) => void
}

type MicProcessOutcome =
  | { ok: true; text: string; recordingId: string }
  | { ok: false; error: MessageKey }

/** Injected from +layout — keeps adapter/engine wiring out of this VM. */
export type MicPendingRecovery = {
  readonly hasPending: boolean
  hydrate(): Promise<{ lastError?: MessageKey } | null>
  dismiss(): Promise<void>
  processBlob(
    blob: Blob,
    mimeType: string,
    ctx: MicTranscribeContext,
  ): Promise<MicProcessOutcome>
  retry(ctx: MicTranscribeContext): Promise<MicProcessOutcome>
}

export class Mic {
  state: MicState = $state("idle")
  error: MessageKey | null = $state(null)
  pendingRestored = $state(false)
  /** Soft hint when permission is still `prompt` (not granted yet). */
  permissionHint: MessageKey | null = $state(null)
  /** True only while requesting and Permissions API reports `prompt`. */
  awaitingPermissionDialog: boolean = $state(false)

  readonly #session: AgentSession
  readonly #recorder: Recorder
  readonly #cues?: CuesEngine
  readonly #recovery: MicPendingRecovery

  constructor(opts: { session: AgentSession; cues?: CuesEngine; recovery: MicPendingRecovery }) {
    this.#session = opts.session
    this.#recorder = new Recorder()
    this.#cues = opts.cues
    this.#recovery = opts.recovery
    void this.refreshPermissionHint()
  }

  get canRetry(): boolean {
    return this.#recovery.hasPending
  }

  refreshPermissionHint = async (): Promise<void> => {
    const state = await probeMicPermission()
    this.permissionHint = state === "prompt" ? "mic.hint.needsAllow" : null
  }

  toggle = async (): Promise<void> => {
    if (this.state === "idle") {
      this.state = "requesting"
      this.error = null
      this.pendingRestored = false
      const perm = await probeMicPermission()
      this.awaitingPermissionDialog = perm === "prompt"
      this.permissionHint = perm === "prompt" ? "mic.hint.needsAllow" : null
      try {
        await this.#recorder.start()
      } catch (e: unknown) {
        this.state = "idle"
        this.awaitingPermissionDialog = false
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          this.error = "mic.error.permission"
          this.permissionHint = null
        } else if (e instanceof DOMException && e.name === "NotFoundError") {
          this.error = "mic.error.notFound"
        } else {
          this.error = "mic.error.generic"
        }
        void this.refreshPermissionHint()
        return
      }
      this.state = "recording"
      this.awaitingPermissionDialog = false
      this.permissionHint = null
      this.#cues?.play("recordingStart")
      return
    }

    if (this.state === "requesting") {
      // getUserMedia in flight — ignore extra taps
      return
    }

    if (this.state === "recording") {
      this.state = "transcribing"
      this.#cues?.play("recordingStop")
      let blob: Blob
      let mimeType: string
      try {
        const result = await this.#recorder.stop()
        blob = result.blob
        mimeType = result.mimeType
      } catch (e: unknown) {
        this.state = "idle"
        console.warn("[mic] recorder.stop() failed", e)
        this.error = "mic.error.generic"
        return
      }

      await this.#runTranscribe(blob, mimeType)
      return
    }
  }

  retryTranscribe = async (): Promise<void> => {
    if (!this.#recovery.hasPending) return
    if (this.state !== "idle") return
    this.state = "transcribing"
    this.error = null
    this.pendingRestored = false
    const outcome = await this.#recovery.retry(this.#transcribeContext())
    this.state = "idle"
    if (!outcome.ok) {
      this.error = outcome.error
    }
  }

  hydratePending = (): Promise<void> => {
    return this.#recovery.hydrate().then((capture) => {
      if (!capture) return
      this.pendingRestored = true
      if (capture.lastError) {
        this.error = capture.lastError
      }
    })
  }

  dismiss = (): Promise<void> => {
    return this.#recovery.dismiss().then(() => {
      this.error = null
      this.pendingRestored = false
    })
  }

  cancel(): void {
    if (this.state === "recording") {
      void this.#recorder.stop().catch(() => {})
      this.state = "idle"
      this.error = null
    }
    // requesting: cannot abort getUserMedia reliably — leave until resolve/reject
  }

  #transcribeContext(): MicTranscribeContext {
    return {
      transcribe: (blob) => transcribe(blob),
      onSend: (text, recordingId) => {
        void this.#session.sendPrompt(text, { recordingId })
      },
    }
  }

  #runTranscribe = async (blob: Blob, mimeType: string): Promise<void> => {
    const outcome = await this.#recovery.processBlob(blob, mimeType, this.#transcribeContext())
    this.state = "idle"
    if (!outcome.ok) {
      this.error = outcome.error
    }
  }
}
