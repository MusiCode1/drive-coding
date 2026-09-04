/**
 * Dictate — type-to-input speech capture (append to draft only; never sends to agent).
 *
 * State machine: idle → requesting → listening → busy → idle
 * `requesting` = waiting for getUserMedia; `awaitingPermissionDialog` only when
 * Permissions API is still `prompt` (permission copy, not stream-open wait).
 *
 * ─── slice voice-pending-persistence: IndexedDB pending + retry/dismiss/hydrate ───
 * ─── slice mic-permission-indication: requesting before listening ───
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import { transcribe } from "../adapters/voice/transcribe"
import { Recorder } from "../engines/recorder"
import { probeMicPermission } from "../util/mic-permission"
import type { ComposerDraft } from "./composer-draft.svelte"
import type { Mic } from "./mic.svelte"

export type DictateState = "idle" | "requesting" | "listening" | "busy"

export type FinishListeningResult =
  | { ok: true; text: string }
  | { ok: false; error: MessageKey }

type DictateTranscribeContext = {
  transcribe: (blob: Blob) => Promise<{ text: string; recordingId: string }>
  onAppend?: (text: string) => void
}

type DictateProcessOutcome =
  | { ok: true; text: string; recordingId: string }
  | { ok: false; error: MessageKey }

export type DictatePendingRecovery = {
  readonly hasPending: boolean
  hydrate(): Promise<{ lastError?: MessageKey } | null>
  dismiss(): Promise<void>
  processBlob(
    blob: Blob,
    mimeType: string,
    ctx: DictateTranscribeContext,
  ): Promise<DictateProcessOutcome>
  retry(ctx: DictateTranscribeContext): Promise<DictateProcessOutcome>
}

export class Dictate {
  state: DictateState = $state("idle")
  error: MessageKey | null = $state(null)
  pendingRestored = $state(false)
  /** True only while requesting and Permissions API reports `prompt`. */
  awaitingPermissionDialog: boolean = $state(false)

  readonly #draft: ComposerDraft
  readonly #mic: Mic
  readonly #recorder: Recorder
  readonly #recovery: DictatePendingRecovery
  #inFlight: Promise<FinishListeningResult> | null = null

  constructor(opts: { draft: ComposerDraft; mic: Mic; recovery: DictatePendingRecovery }) {
    this.#draft = opts.draft
    this.#mic = opts.mic
    this.#recorder = new Recorder()
    this.#recovery = opts.recovery
  }

  get canRetry(): boolean {
    return this.#recovery.hasPending
  }

  finishListening = (): Promise<FinishListeningResult> => {
    if (this.state === "idle" || this.state === "requesting") {
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
      this.state = "requesting"
      this.error = null
      this.pendingRestored = false
      this.awaitingPermissionDialog = this.#mic.permissionHint === "mic.hint.needsAllow"
      void probeMicPermission().then((perm) => {
        if (this.state !== "requesting") return
        this.awaitingPermissionDialog = perm === "prompt"
        this.#mic.permissionHint = perm === "prompt" ? "mic.hint.needsAllow" : null
      })
      try {
        await this.#recorder.start()
      } catch (e: unknown) {
        this.state = "idle"
        this.awaitingPermissionDialog = false
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          this.error = "dictate.error.permission"
        } else if (e instanceof DOMException && e.name === "NotFoundError") {
          this.error = "dictate.error.notFound"
        } else {
          this.error = "dictate.error.generic"
        }
        void this.#mic.refreshPermissionHint()
        return
      }
      this.state = "listening"
      this.awaitingPermissionDialog = false
      this.#mic.permissionHint = null
      return
    }

    if (this.state === "requesting") {
      return
    }

    if (this.state === "listening") {
      const result = await this.#runTranscribe()
      if (result.ok && result.text.trim().length > 0) {
        this.#draft.appendDictation(result.text)
      }
      return
    }
  }

  retryTranscribe = async (): Promise<void> => {
    if (!this.#recovery.hasPending) return
    if (this.state !== "idle") return
    this.state = "busy"
    this.error = null
    this.pendingRestored = false
    const outcome = await this.#recovery.retry(this.#transcribeContext())
    this.state = "idle"
    if (outcome.ok) {
      if (outcome.text.trim().length > 0) {
        this.#draft.appendDictation(outcome.text)
      }
    } else {
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
    let mimeType: string
    try {
      const result = await this.#recorder.stop()
      blob = result.blob
      mimeType = result.mimeType
    } catch (e: unknown) {
      this.state = "idle"
      console.warn("[dictate] recorder.stop() failed", e)
      this.error = "dictate.error.generic"
      return { ok: false, error: "dictate.error.generic" }
    }

    const outcome = await this.#recovery.processBlob(blob, mimeType, this.#transcribeContext())
    this.state = "idle"
    if (!outcome.ok) {
      this.error = outcome.error
      return { ok: false, error: outcome.error }
    }
    this.error = null
    return { ok: true, text: outcome.text.trim().length > 0 ? outcome.text : "" }
  }

  #transcribeContext(): DictateTranscribeContext {
    return {
      transcribe: (b) => transcribe(b),
    }
  }
}
