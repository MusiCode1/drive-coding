/**
 * Layout wiring for pending voice captures. Dictate uses the legacy global slot.
 * Record operations hold a stable recovery and share an owner revision in this tab.
 */
import type { PendingCapture } from "@drive-coding/core/voice/pending-capture"
import { createPendingCaptureStore } from "../adapters/pending-capture-store"
import { createRecordCaptureStore } from "../adapters/record-capture-store"
import { transcribe } from "../adapters/voice/transcribe"
import type { SessionView } from "../session/session-view"
import { beUrl } from "../util/be-url"
import { PendingCaptureRecovery, type TranscribeContext } from "./pending-capture-recovery"

export function createDictateRecovery(): PendingCaptureRecovery {
  return new PendingCaptureRecovery(createPendingCaptureStore(), {
    source: "dictate",
    transcribeErrorKey: "dictate.error.transcribe",
  })
}

export type RecordTarget = Readonly<{
  ownerKey: string
  backendBaseUrl: string
  view: SessionView
  agentId: string
  generation: number
}>

export type RecordTargetSource = {
  current(): RecordTarget | null
  isCurrent(target: RecordTarget): boolean
}

export type RecordCaptureEntry = Readonly<{
  ownerKey: string
  revision: number
  capture: PendingCapture
  restored: boolean
}>

type RecordSlot = {
  revision: number
  active?: symbol
  entry?: RecordCaptureEntry
  recovery?: PendingCaptureRecovery
}

type RecordAttempt = {
  canTranscribe(): boolean
  transcribe: TranscribeContext["transcribe"]
  onSend(text: string, recordingId: string): boolean
}

export function createRecordAttempt(
  backendBaseUrl: string,
  onSend: RecordAttempt["onSend"],
): RecordAttempt {
  const recordSttProxyBaseUrl = `${backendBaseUrl}/proxy/google/`
  return {
    canTranscribe: () => {
      try {
        return new URL(beUrl("/")).href.replace(/\/$/, "") === backendBaseUrl
      } catch {
        return false
      }
    },
    transcribe: (blob) => transcribe(blob, { recordSttProxyBaseUrl }),
    onSend,
  }
}

export class RecordCaptureCoordinator {
  readonly #store = createRecordCaptureStore()
  readonly #owners = new Map<string | null, RecordSlot>()

  constructor(private readonly notify: () => void) {}

  #slot(ownerKey: string | null): RecordSlot {
    const existing = this.#owners.get(ownerKey)
    if (existing) return existing
    const slot: RecordSlot = { revision: 0 }
    this.#owners.set(ownerKey, slot)
    return slot
  }

  #recovery(ownerKey: string | null): PendingCaptureRecovery {
    return new PendingCaptureRecovery(this.#store.forOwner(ownerKey), {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    })
  }

  get(ownerKey: string): RecordCaptureEntry | undefined {
    return this.#owners.get(ownerKey)?.entry
  }

  has(entry: RecordCaptureEntry): boolean {
    const current = this.get(entry.ownerKey)
    return current?.revision === entry.revision && current.capture.id === entry.capture.id
  }

  async hydrate(ownerKey: string, isCurrent: () => boolean): Promise<void> {
    const slot = this.#slot(ownerKey)
    if (slot.active) return
    const { revision, entry } = slot
    const recovery = this.#recovery(ownerKey)
    await recovery.hydrate()
    if (slot.active || slot.revision !== revision || slot.entry !== entry || !isCurrent()) return
    this.#publish(ownerKey, slot, recovery, true)
  }

  async process(
    ownerKey: string | null,
    blob: Blob,
    mimeType: string,
    attempt: RecordAttempt | null,
  ): Promise<void> {
    const slot = this.#slot(ownerKey)
    const operation = Symbol()
    const recovery = this.#recovery(ownerKey)
    slot.revision++
    slot.active = operation
    slot.entry = undefined
    this.notify()
    try {
      await recovery.saveCapture(blob, mimeType)
      if (ownerKey !== null && attempt && slot.active === operation) {
        await this.#transcribe(ownerKey, slot, operation, recovery, attempt)
      }
    } finally {
      this.#finish(ownerKey, slot, operation, recovery)
    }
  }

  async retry(entry: RecordCaptureEntry, attempt: RecordAttempt): Promise<void> {
    const slot = this.#slot(entry.ownerKey)
    const recovery = slot.recovery
    if (!recovery || slot.active || !this.has(entry)) return
    const operation = Symbol()
    slot.active = operation
    try {
      await this.#transcribe(entry.ownerKey, slot, operation, recovery, attempt)
    } finally {
      this.#finish(entry.ownerKey, slot, operation, recovery)
    }
  }

  dismiss(entry: RecordCaptureEntry): Promise<void> {
    if (!this.has(entry)) return Promise.resolve()
    const slot = this.#slot(entry.ownerKey)
    slot.revision++
    slot.active = undefined
    slot.entry = undefined
    slot.recovery = undefined
    this.notify()
    return this.#store.forOwner(entry.ownerKey).remove(entry.capture.id)
  }

  #transcribe(
    ownerKey: string,
    slot: RecordSlot,
    operation: symbol,
    recovery: PendingCaptureRecovery,
    attempt: RecordAttempt,
  ) {
    const revision = slot.revision
    const captureId = recovery.capture?.id
    const isCaptureCurrent = (id: string) =>
      slot.active === operation && slot.revision === revision && captureId === id
    if (!recovery.capture?.transcribedText && !attempt.canTranscribe()) return
    return recovery.retry({
      transcribe: attempt.transcribe,
      isCaptureCurrent,
      verifyHandoff: (id) =>
        isCaptureCurrent(id) ? this.#store.forOwner(ownerKey).matches(id) : Promise.resolve(false),
      onSend: (text: string, recordingId: string) =>
        captureId !== undefined && isCaptureCurrent(captureId) && attempt.onSend(text, recordingId),
    })
  }

  #finish(
    ownerKey: string | null,
    slot: RecordSlot,
    operation: symbol,
    recovery: PendingCaptureRecovery,
  ) {
    if (slot.active !== operation) return
    slot.active = undefined
    if (ownerKey !== null) this.#publish(ownerKey, slot, recovery, !recovery.capture?.lastError)
  }

  #publish(
    ownerKey: string,
    slot: RecordSlot,
    recovery: PendingCaptureRecovery,
    restored: boolean,
  ) {
    const capture = recovery.capture
    slot.recovery = capture ? recovery : undefined
    slot.entry = capture ? { ownerKey, revision: slot.revision, capture, restored } : undefined
    this.notify()
  }
}
