import type { MessageKey } from "@drive-coding/core/i18n"
import {
  type FailedPrompt,
  canSendStoredPrompt,
  failedPromptStore,
} from "../adapters/failed-prompt-store"
import type { RecordTarget, RecordTargetSource } from "../engines/pending-capture-wiring"
import type { PromptPayload } from "../engines/prompt-payload"
import type { GuidanceAuthMethod } from "../util/auth-guidance"
import { deliverClaimedPrompt, watchPromptRecovery } from "./agent-session-prompt-send"

type Store = typeof failedPromptStore
type Adoption = Parameters<Store["adopt"]>[2]

export class PromptRetry {
  #shown = $state.raw<{ target: RecordTarget; record: FailedPrompt | undefined }>()
  #errors = $state.raw(new Map<string, MessageKey>())
  #guidance = $state.raw(
    new Map<
      string,
      {
        attemptId: string
        methods: ReadonlyArray<GuidanceAuthMethod>
      }
    >(),
  )
  #revision = 0
  #busy = new Set<string>()
  #clock = $state(0)
  #expiry?: ReturnType<typeof setTimeout>

  constructor(
    readonly targets: RecordTargetSource,
    private readonly onDispatch: (text: string) => void,
    private readonly store: Store = failedPromptStore,
    private readonly now = Date.now,
  ) {}
  hasRecordReceipt(owner: string, id: string): Promise<boolean> {
    return this.store.hasRecordReceipt(owner, id)
  }

  get record(): FailedPrompt | undefined {
    const shown = this.#shown
    return shown && this.targets.isCurrent(shown.target) ? shown.record : undefined
  }

  get error(): MessageKey | undefined {
    const owner = this.targets.current()?.ownerKey
    return owner === undefined ? undefined : this.#errors.get(owner)
  }

  get authMethods(): ReadonlyArray<GuidanceAuthMethod> {
    const record = this.record
    const guidance = record && this.#guidance.get(record.owner)
    return guidance?.attemptId === record?.attemptId ? (guidance?.methods ?? []) : []
  }

  get claimActive(): boolean {
    void this.#clock
    return (this.record?.claimUntil ?? 0) > this.now()
  }

  get action(): MessageKey | undefined {
    const record = this.record
    if (!record || this.claimActive || !canSendStoredPrompt(record)) return
    return record.delivery === "not-started" ? "chat.send" : "chat.prompt.retry"
  }

  get message(): MessageKey | undefined {
    const record = this.record
    if (!record) return
    if (record.delivery === "not-started") return "chat.prompt.notStarted"
    if (record.delivery === "unknown") return "chat.prompt.deliveryUnknown"
    if (record.reason === "session-mismatch") return "chat.prompt.sessionMismatch"
    return "chat.prompt.rejected"
  }

  report(owner: string, error?: MessageKey): void {
    const errors = new Map(this.#errors)
    if (error) errors.set(owner, error)
    else errors.delete(owner)
    this.#errors = errors
  }

  async refresh(target = this.targets.current()): Promise<void> {
    const revision = ++this.#revision
    if (!target) return
    try {
      const record = await this.store.load(target.ownerKey)
      if (revision === this.#revision && this.targets.isCurrent(target)) this.#show(target, record)
    } catch {
      if (revision === this.#revision && this.targets.isCurrent(target)) {
        this.report(target.ownerKey, "chat.prompt.storageError")
      }
    }
  }

  watch(refreshSources: () => void, onDeleted: (owner: string) => void): () => void {
    return watchPromptRecovery(
      this,
      (listener) => this.store.onOwnerDeleted(listener),
      refreshSources,
      onDeleted,
    )
  }

  dispose(): void {
    ++this.#revision
    clearTimeout(this.#expiry)
  }
  async adopt(target: RecordTarget, payload: PromptPayload, origin?: Adoption): Promise<boolean> {
    const result = await this.#mutate(target, async () => {
      if (!target.view.promptTo) {
        this.report(target.ownerKey, "chat.prompt.storageError")
        return false
      }
      const adoption = await this.store.adopt(target.ownerKey, payload, origin)
      if (adoption.kind === "already-adopted") return true
      if (adoption.kind !== "claimed") {
        this.report(
          target.ownerKey,
          adoption.kind === "occupied" ? "chat.prompt.resolvePrevious" : "chat.prompt.storageError",
        )
        return false
      }
      this.#adopted(target, adoption.record)
      return true
    })
    return result === true
  }

  retry(expected: FailedPrompt, target = this.targets.current()): Promise<void | undefined> {
    if (!target || target.ownerKey !== expected.owner || !target.view.promptTo)
      return Promise.resolve()
    return this.#mutate(target, async () => {
      const record = await this.store.retry(expected)
      if (record) this.#adopted(target, record)
    })
  }

  dismiss(expected: FailedPrompt, target = this.targets.current()): Promise<void | undefined> {
    if (!target || target.ownerKey !== expected.owner) return Promise.resolve()
    return this.#mutate(target, async () => {
      await this.store.dismiss(expected)
    })
  }

  async #mutate<T>(target: RecordTarget, action: () => Promise<T>): Promise<T | undefined> {
    const owner = target.ownerKey
    if (!this.targets.isCurrent(target) || this.#busy.has(owner)) return
    this.#busy.add(owner)
    ++this.#revision
    this.report(owner)
    try {
      return await action()
    } catch {
      this.report(owner, "chat.prompt.storageError")
    } finally {
      this.#busy.delete(owner)
      const active = this.targets.current()
      if (active?.ownerKey === owner) void this.refresh(active)
    }
  }

  #show(target: RecordTarget, record: FailedPrompt | undefined) {
    this.#shown = { target, record }
    const guidance = this.#guidance.get(target.ownerKey)
    if (guidance && guidance.attemptId !== record?.attemptId) {
      const remaining = new Map(this.#guidance)
      remaining.delete(target.ownerKey)
      this.#guidance = remaining
    }
    clearTimeout(this.#expiry)
    const ms = (record?.claimUntil ?? 0) - this.now()
    if (ms > 0) {
      this.#expiry = setTimeout(() => {
        this.#clock++
        if (this.targets.isCurrent(target)) void this.refresh(target)
      }, ms)
    }
  }

  #adopted(target: RecordTarget, record: FailedPrompt) {
    if (this.targets.isCurrent(target)) {
      ++this.#revision
      this.#show(target, record)
    }
    // Let the source receive its local adoption ACK independently of the transport.
    queueMicrotask(() => void this.#dispatch(target, record))
  }

  #dispatch(target: RecordTarget, record: FailedPrompt): Promise<void> {
    return deliverClaimedPrompt(target, record, {
      targets: this.targets,
      store: this.store,
      now: () => this.now(),
      onDispatch: (text) => this.onDispatch(text),
      report: (owner, error) => this.report(owner, error),
      refresh: (active) => this.refresh(active),
      invalidate: () => {
        ++this.#revision
      },
      showGuidance: (owner, attemptId, methods) => {
        this.#guidance = new Map(this.#guidance).set(owner, { attemptId, methods })
      },
    })
  }
}
