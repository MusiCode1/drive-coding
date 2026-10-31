import type { Patch } from "@drive-coding/core/session"
import { connWarn } from "$lib/util/conn-log"
import type { RemoteSessionReplacement } from "./remote-session-replacement"
import type {
  RemoteSnapshot,
  RemoteSource,
  RemoteStreamEvent,
  RemoteTerminal,
} from "./remote-stream-events"
import type { SessionViewDelivery } from "./session-view-delivery"
import { projectRemoteTerminal, projectSessionSnapshot } from "./session-view-projection"

type DeliveryDeps = {
  delivery: SessionViewDelivery
  replacement: RemoteSessionReplacement
  dispose(): void
  terminal(fact: RemoteTerminal): void
  adoptSession(sessionId: string | null): void
  reconnected(): void
}

/** Admission metadata belongs to one RemoteSessionView; canonical state stays in delivery. */
export class RemoteStreamDelivery {
  #closed = false
  #source: RemoteSource | undefined
  #lifetime = {}
  #lastVersion = 0
  #lastReadMessageId: string | null = null
  #lastReadSegmentIndex = 0
  #terminal: RemoteTerminal | undefined
  constructor(private readonly d: DeliveryDeps) {}
  get closed(): boolean {
    return this.#closed
  }
  get terminalFact(): RemoteTerminal | undefined {
    return this.#terminal
  }
  get hostIncarnation(): string | undefined {
    return this.#source?.hostIncarnation
  }
  get lastVersion(): number {
    return this.#lastVersion
  }
  get lastReadMessageId(): string | null {
    return this.#lastReadMessageId
  }
  get lastReadSegmentIndex(): number {
    return this.#lastReadSegmentIndex
  }
  prime(initial: RemoteSnapshot): void {
    if (this.#closed) return
    this.#source = initial.source
    this.#lastVersion = initial.state.version
    this.d.delivery.state = initial.state
    this.d.adoptSession(initial.state.sessionId)
  }
  captureContext(): () => boolean {
    const lifetime = this.#lifetime
    const host = this.hostIncarnation
    return () => !this.#closed && lifetime === this.#lifetime && host === this.hostIncarnation
  }
  guardHttpResult(localClose = false): () => void {
    if (this.#closed && !localClose) throw new Error("RemoteSessionView: closed")
    const lifetime = this.#lifetime
    const host = this.hostIncarnation
    return () => {
      if (
        (!localClose && (this.#closed || lifetime !== this.#lifetime)) ||
        host !== this.hostIncarnation ||
        this.#terminal
      )
        throw new Error("RemoteSessionView: obsolete HTTP result")
    }
  }
  stop(): void {
    this.#lifetime = {}
  }
  #current(source: RemoteSource, lifetime = this.#lifetime): boolean {
    return !this.#closed && lifetime === this.#lifetime && this.#source === source
  }
  snapshot(event: RemoteSnapshot, initial = false): void {
    if (this.#closed) return
    const previous = this.#source
    const recreated =
      previous !== undefined && previous.hostIncarnation !== event.source.hostIncarnation
    this.#source = event.source
    const state = event.state
    if (!initial && !recreated && state.version <= this.#lastVersion) {
      if (state.version < this.#lastVersion)
        connWarn("sse-version-regression", { got: state.version, have: this.#lastVersion })
      if (this.#current(event.source)) this.d.reconnected()
      return
    }
    if (recreated) this.stop()
    const admittedLifetime = this.#lifetime
    const admitted = () => this.#current(event.source, admittedLifetime)
    const sessionChanged = state.sessionId !== this.d.delivery.state.sessionId
    this.#lastVersion = state.version
    this.#lastReadMessageId = null
    this.#lastReadSegmentIndex = 0
    this.d.adoptSession(state.sessionId)
    if (!admitted()) return
    const prepared = initial
      ? { frame: projectSessionSnapshot(state, state.messages.length > 0), intent: undefined }
      : this.d.replacement.prepareSnapshot(state, recreated || sessionChanged)
    const { frame, intent } = prepared
    if (recreated) frame.boundary = "host-recreated"
    this.d.delivery.frame(frame, true, admitted, () => this.d.replacement.consume(intent))
    if (!admitted()) return
    this.d.delivery.endBatch(state)
    if (!admitted()) return
    if (!initial) this.d.reconnected()
  }
  event(event: RemoteStreamEvent): void {
    if (event.kind === "snapshot") {
      this.snapshot(event)
      return
    }
    if (!this.#current(event.source)) return
    if (event.kind === "terminal") return
    const lifetime = this.#lifetime
    const current = () => this.#current(event.source, lifetime)
    const batch = event.batch
    if (batch.version <= Math.max(this.#lastVersion, this.d.delivery.state.version)) return
    let last = this.d.delivery.state
    for (const update of batch.updates) {
      if (!current()) return
      const intent = this.d.replacement.capture()
      const frame = this.d.delivery.update(update, true, batch.version, current, (committed) => {
        if (committed.reset) this.d.replacement.consume(intent)
      })
      if (!current()) return
      last = frame.state
      for (const patch of frame.patches) this.#advance(patch)
    }
    if (!current()) return
    this.d.delivery.state = { ...this.d.delivery.state, version: batch.version }
    this.#lastVersion = batch.version
    if (batch.updates.length > 0) this.d.delivery.endBatch(last)
  }
  beginClose(): boolean {
    if (this.#closed) return false
    this.#closed = true
    this.stop()
    return true
  }
  terminal(fact: RemoteTerminal): void {
    if (this.#closed || (this.#source !== undefined && this.#source !== fact.source)) return
    this.#terminal = fact
    this.#closed = true
    this.stop()
    const lifetime = this.#lifetime
    const permit = () => this.#terminal === fact && lifetime === this.#lifetime
    try {
      this.d.delivery.frame(projectRemoteTerminal(this.d.delivery.state), true, permit)
      if (permit()) this.d.delivery.endBatch(this.d.delivery.state)
    } finally {
      try {
        this.d.terminal(fact)
      } catch (error) {
        console.warn("RemoteSessionView: terminal observer failed", error)
      } finally {
        this.d.dispose()
      }
    }
  }
  async consume(events: ReadableStream<RemoteStreamEvent>): Promise<void> {
    const reader = events.getReader()
    try {
      while (!this.#closed) {
        const { done, value } = await reader.read()
        if (done || this.#closed) break
        if (value.kind === "terminal") {
          this.terminal(value)
          break
        }
        try {
          this.event(value)
        } catch (error) {
          console.warn("RemoteSessionView: error applying frame, skipping", error)
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
  #advance(patch: Patch): void {
    if (patch.op !== "append-segment") return
    const message = this.d.delivery.state.messages.find((item) => item.id === patch.targetId)
    if (!message || message.role === "tool") return
    this.#lastReadMessageId = message.id
    this.#lastReadSegmentIndex = message.segments.length - 1
  }
}
