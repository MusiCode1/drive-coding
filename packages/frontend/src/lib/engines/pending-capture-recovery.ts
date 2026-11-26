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
  /** False retains the transcript. A promise covers durable local handoff only. */
  onSend?: (text: string, recordingId: string) => boolean | void | Promise<boolean>
  handoffEmpty?: boolean
  onAppend?: (text: string) => void
  isCaptureCurrent?: (id: string) => boolean
  verifyHandoff?: (id: string) => Promise<boolean>
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

  async processBlob(blob: Blob, mimeType: string, ctx: TranscribeContext): Promise<ProcessOutcome> {
    await this.saveCapture(blob, mimeType)
    return this.#runTranscribe(ctx)
  }

  async saveCapture(blob: Blob, mimeType: string): Promise<void> {
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
    const isCurrent = () => ctx.isCaptureCurrent?.(capture.id) !== false
    const interrupted = { ok: false, error: this.#transcribeErrorKey } as const
    if (!isCurrent()) return interrupted

    let text: string
    let recordingId: string

    if (capture.transcribedText !== undefined && (ctx.handoffEmpty || capture.transcribedText.length > 0)) {
      text = capture.transcribedText
      recordingId = capture.recordingId
    } else {
      try {
        const result = await ctx.transcribe(blob)
        text = result.text
        recordingId = result.recordingId
      } catch (e: unknown) {
        if (!isCurrent()) return interrupted
        console.warn("[pending-capture-recovery] transcribe() failed", e)
        await this.#store.updateMeta(capture.id, { lastError: this.#transcribeErrorKey })
        if (!isCurrent()) return interrupted
        this.#capture = { ...capture, lastError: this.#transcribeErrorKey }
        return { ok: false, error: this.#transcribeErrorKey }
      }
      if (!isCurrent()) return interrupted
      await this.#store.updateMeta(capture.id, { transcribedText: text, recordingId })
      if (!isCurrent()) return interrupted
      this.#capture = { ...capture, transcribedText: text, recordingId }
    }

    ctx.onTranscribed?.(text)

    const outcome = { ok: true, text, recordingId } as const
    if (text.trim().length > 0 || ctx.handoffEmpty) {
      if (ctx.verifyHandoff && !(await ctx.verifyHandoff(capture.id))) return outcome
      if (!isCurrent()) return outcome
      const handoff = ctx.onSend?.(text, recordingId)
      const adopted = typeof handoff === "object" ? await handoff : handoff
      if (adopted === false || !isCurrent()) return outcome
      ctx.onAppend?.(text)
    }

    if (!isCurrent()) return outcome
    await this.#store.remove(capture.id)
    this.#capture = null
    this.#blob = null
    return outcome
  }
}
