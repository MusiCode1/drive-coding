import type { MessageKey } from "@drive-coding/core/i18n"
import {
  DictateSourceConflict,
  type DictateSubmitSource,
  dictateSubmitCaptureStore,
  dictateSubmitSourceDb,
  resolveDictateSubmitSource,
} from "../adapters/dictate-submit-source"
import { transcribe } from "../adapters/voice/transcribe"
import { PendingCaptureRecovery } from "../engines/pending-capture-recovery"
import type { RecordTarget } from "../engines/pending-capture-wiring"
import { dictatedPayload, hasPromptContent, type PromptPayload } from "../engines/prompt-payload"
import type { PromptRetry } from "./prompt-retry.svelte"

type LiveDraft = { text(): string; adopted(text: string): void }
type Candidate = { source: DictateSubmitSource; expectedVersion?: number }
type StopCapture = () => Promise<{ blob: Blob; mimeType: string }>
export class DictateSubmit {
  #shown = $state.raw<{ target: RecordTarget; source: DictateSubmitSource | undefined }>()
  #busy = $state.raw(new Set<string>())
  #ram = new Map<string, Candidate>()
  #revision = 0

  constructor(
    private readonly prompts: PromptRetry,
    private readonly db = dictateSubmitSourceDb,
    private readonly speech = transcribe,
  ) {}

  get source(): DictateSubmitSource | undefined {
    const shown = this.#shown
    return shown && this.prompts.targets.isCurrent(shown.target) ? shown.source : undefined
  }

  get busy(): boolean {
    const target = this.prompts.targets.current()
    return !!target && this.#busy.has(target.ownerKey)
  }

  get error(): MessageKey | undefined {
    const capture = this.source?.capture
    return capture?.transcribedText === undefined ? capture?.lastError : undefined
  }

  get payload(): PromptPayload | undefined {
    const source = this.source
    const text = source?.capture.transcribedText
    return source && text !== undefined ? dictatedPayload(source.snapshot, text) : undefined
  }

  async refresh(target = this.prompts.targets.current()): Promise<void> {
    const revision = ++this.#revision
    if (!target) return
    const owner = target.ownerKey
    try {
      const stored = await this.db.load(owner)
      if (revision !== this.#revision || !this.prompts.targets.isCurrent(target)) return
      const candidate = this.#ram.get(owner)
      const useCandidate =
        candidate && (!stored || stored.capture.id === candidate.source.capture.id)
      this.#shown = { target, source: useCandidate ? candidate.source : stored }
    } catch {
      if (revision !== this.#revision || !this.prompts.targets.isCurrent(target)) return
      const candidate = this.#ram.get(owner)
      if (candidate) this.#shown = { target, source: candidate.source }
      this.prompts.report(owner, "chat.prompt.storageError")
    }
  }

  ownerDeleted(owner: string): void {
    this.#ram.delete(owner)
    const active = this.prompts.targets.current()
    if (active?.ownerKey === owner) void this.refresh(active)
  }

  async finish(
    target: RecordTarget,
    snapshot: PromptPayload,
    stop: StopCapture,
    live: LiveDraft,
  ): Promise<void> {
    await this.#operate(target, async () => {
      const owner = target.ownerKey
      if (this.#ram.has(owner) || (await this.db.load(owner))) {
        this.prompts.report(owner, "chat.prompt.resolvePrevious")
        return
      }
      const { blob, mimeType } = await stop()
      const operation = this.#capture(target, snapshot, live)
      await operation.recovery.processBlob(blob, mimeType, operation.context)
    })
  }

  async resume(
    expected: DictateSubmitSource,
    target = this.prompts.targets.current(),
  ): Promise<void> {
    if (!target || target.ownerKey !== expected.owner) return
    await this.#operate(target, async () => {
      const source = await this.#validated(expected)
      if (!source || !this.prompts.targets.isCurrent(target)) return
      const operation = this.#capture(target, source.snapshot, undefined, source)
      await operation.recovery.hydrate()
      await operation.recovery.retry(operation.context)
    })
  }

  async dismiss(
    expected: DictateSubmitSource,
    target = this.prompts.targets.current(),
  ): Promise<void> {
    if (!target || target.ownerKey !== expected.owner) return
    await this.#operate(target, async () => {
      const stored = await this.db.load(expected.owner)
      const candidate = this.#ram.get(expected.owner)
      if (stored?.capture.id === expected.capture.id && stored.version === expected.version) {
        await this.db.remove(stored)
      } else if (stored || candidate?.source !== expected) {
        return
      }
      if (candidate?.source.capture.id === expected.capture.id) this.#ram.delete(expected.owner)
    })
  }

  async #validated(expected: DictateSubmitSource) {
    const candidate = this.#ram.get(expected.owner)
    const matching = candidate?.source === expected ? candidate : undefined
    const source = await resolveDictateSubmitSource(this.db, expected, matching)
    if (matching) this.#ram.delete(expected.owner)
    return source
  }

  #capture(
    target: RecordTarget,
    snapshot: PromptPayload,
    live?: LiveDraft,
    initial?: DictateSubmitSource,
  ) {
    const owner = target.ownerKey
    let saved = initial
    const store = dictateSubmitCaptureStore({
      owner,
      snapshot,
      initial,
      db: this.db,
      onCandidate: (source, expectedVersion) => this.#ram.set(owner, { source, expectedVersion }),
      onSaved: (source) => {
        this.#ram.delete(owner)
        saved = source
      },
    })
    const recovery = new PendingCaptureRecovery(store, {
      source: "dictate",
      transcribeErrorKey: "dictate.error.transcribe",
    })
    const context = {
      transcribe: (blob: Blob) => this.speech(blob),
      handoffEmpty: true,
      onSend: async (text: string) => {
        if (!saved) return false
        const current = this.prompts.targets.isCurrent(target)
        const draftText = current && live ? live.text() : snapshot.text
        const payload = dictatedPayload(snapshot, text, draftText)
        if (!hasPromptContent(payload) && !hasPromptContent(snapshot)) return true
        if (!current || !hasPromptContent(payload)) return false
        const adopted = await this.prompts.adopt(target, payload, {
          dictate: { id: saved.capture.id, version: saved.version },
        })
        if (adopted && this.prompts.targets.isCurrent(target)) live?.adopted(draftText)
        return adopted
      },
    }
    return { recovery, context }
  }

  async #operate(target: RecordTarget, operation: () => Promise<void>): Promise<void> {
    const owner = target.ownerKey
    if (!this.prompts.targets.isCurrent(target) || this.#busy.has(owner)) return
    this.#busy = new Set([...this.#busy, owner])
    ++this.#revision
    this.prompts.report(owner)
    try {
      await operation()
    } catch (error) {
      if (error instanceof DictateSourceConflict) {
        const candidate = this.#ram.get(owner)
        if (error.reason === "deleted" || candidate?.expectedVersion !== undefined) {
          this.#ram.delete(owner)
        }
      }
      this.prompts.report(owner, "chat.prompt.storageError")
    } finally {
      const busy = new Set(this.#busy)
      busy.delete(owner)
      this.#busy = busy
      const active = this.prompts.targets.current()
      if (active?.ownerKey === owner) void this.refresh(active)
    }
  }
}
