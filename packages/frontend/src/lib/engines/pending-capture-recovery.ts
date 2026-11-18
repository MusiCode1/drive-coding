/**
 * pending-capture-recovery.ts — engine for pending voice capture retry/hydrate.
 * (slice voice-pending-persistence, Commit 2)
 *
 * Store only — transcribe is injected by the VM (no adapters/ imports here).
 */
import type { MessageKey } from "@drive-coding/core/i18n"
import type {
  PendingCapture,
  PendingCaptureSource,
  PendingCaptureStore,
} from "@drive-coding/core/voice/pending-capture"
import { safeUUID } from "../util/uuid"

export type TranscribeContext = {
  transcribe: (blob: Blob) => Promise<{ text: string; recordingId: string }>
  onTranscribed?: (text: string) => void
  onSend?: (text: string, recordingId: string) => void
  onAppend?: (text: string) => void
}

export type ProcessOutcome =
  | { ok: true; text: string; recordingId: string }
  | { ok: false; error: MessageKey }

export class PendingCaptureRecovery {
  readonly #store: PendingCaptureStore
  readonly #source: PendingCaptureSource
  readonly #transcribeErrorKey: MessageKey

  #capture: PendingCapture | null = null
  #blob: Blob | null = null

  constructor(
    store: PendingCaptureStore,
    opts: { source: PendingCaptureSource; transcribeErrorKey: MessageKey },
  ) {
    this.#store = store
    this.#source = opts.source
    this.#transcribeErrorKey = opts.transcribeErrorKey
  }

  get hasPending(): boolean {
    return this.#capture !== null && this.#blob !== null
  }

  get capture(): PendingCapture | null {
    return this.#capture
  }

  async hydrate(): Promise<PendingCapture | null> {
    const loaded = await this.#store.load()
    if (!loaded || loaded.capture.source !== this.#source) {
      this.#capture = null
      this.#blob = null
      return null
    }
    this.#capture = loaded.capture
    this.#blob = loaded.blob
    return loaded.capture
  }

  async dismiss(): Promise<void> {
    if (this.#capture) {
      await this.#store.remove(this.#capture.id)
    }
    this.#capture = null
    this.#blob = null
  }

  async processBlob(
    blob: Blob,
    mimeType: string,
    ctx: TranscribeContext,
  ): Promise<ProcessOutcome> {
    const capture: PendingCapture = {
      id: safeUUID(),
      source: this.#source,
      mimeType,
      createdAt: new Date().toISOString(),
      recordingId: "",
    }
    await this.#store.save(capture, blob)
    this.#capture = capture
    this.#blob = blob
    return this.#runTranscribe(ctx)
  }

  async retry(ctx: TranscribeContext): Promise<ProcessOutcome> {
    if (!this.#capture || !this.#blob) {
      return { ok: false, error: this.#transcribeErrorKey }
    }
    return this.#runTranscribe(ctx)
  }

  async #runTranscribe(ctx: TranscribeContext): Promise<ProcessOutcome> {
    const capture = this.#capture
    const blob = this.#blob
    if (!capture || !blob) {
      return { ok: false, error: this.#transcribeErrorKey }
    }

    let text: string
    let recordingId: string

    if (capture.transcribedText !== undefined && capture.transcribedText.length > 0) {
      text = capture.transcribedText
      recordingId = capture.recordingId
    } else {
      try {
        const result = await ctx.transcribe(blob)
        text = result.text
        recordingId = result.recordingId
        await this.#store.updateMeta(capture.id, {
          transcribedText: text,
          recordingId,
        })
        this.#capture = { ...capture, transcribedText: text, recordingId }
      } catch (e: unknown) {
        console.warn("[pending-capture-recovery] transcribe() failed", e)
        await this.#store.updateMeta(capture.id, {
          lastError: this.#transcribeErrorKey,
        })
        this.#capture = { ...capture, lastError: this.#transcribeErrorKey }
        return { ok: false, error: this.#transcribeErrorKey }
      }
    }

    ctx.onTranscribed?.(text)

    if (text.trim().length > 0) {
      ctx.onSend?.(text, recordingId)
      ctx.onAppend?.(text)
    }

    await this.#store.remove(capture.id)
    this.#capture = null
    this.#blob = null
    return { ok: true, text, recordingId }
  }
}
