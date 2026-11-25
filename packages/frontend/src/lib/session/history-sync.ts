import { drainHistoryUpdates, HistoryGate } from "./history-drain"
import type { SettledGet } from "./history-open"
import { startParallelHistoryGet } from "./history-sync-parallel"
import { triggerHistoryReload } from "./history-sync-trigger"
import { emitHistoryState } from "./history-sync-emit"
import { finishHistoryOpen } from "./history-sync-finish"
import { loadFullHistory } from "./history-sync-load"
import type { HistorySyncPort } from "./history-sync-port"
import { applyLegacyReconnect, planReconnect } from "./history-sync-reconnect"
import type { HistoryWindow } from "./history-window"
import type { HistoryController } from "./session-view"
import type { OpeningFrame } from "./wire/frame-decode"
import type { FrameReader } from "./wire/frame-reader"
import type { SessionPipe } from "./wire/pipe"

export class HistorySync implements HistoryController {
  readonly #port: HistorySyncPort
  readonly #pipe: SessionPipe
  readonly #reader: FrameReader
  readonly #sleep: (ms: number) => Promise<void>

  #window: HistoryWindow = { firstSeq: null, lastSeq: null, hasMore: false, watermark: 0 }
  #error: string | null = null
  #reloading = false
  #gate = new HistoryGate()
  #generation = 0
  #reloadGeneration = 0
  #activeConnection = 0
  #genAbort: AbortController | null = null
  #warnedOutside = new Set<number>()
  #metaMode = false
  #drainAbort: AbortController | null = null
  #pendingGet: Promise<SettledGet> | null = null

  constructor(
    port: HistorySyncPort,
    pipe: SessionPipe,
    reader: FrameReader,
    sleep: (ms: number) => Promise<void>,
  ) {
    this.#port = port
    this.#pipe = pipe
    this.#reader = reader
    this.#sleep = sleep
  }

  get window(): HistoryWindow {
    return this.#window
  }
  get error(): string | null {
    return this.#error
  }
  get reloading(): boolean {
    return this.#reloading
  }
  get activeConnection(): number {
    return this.#activeConnection
  }

  beginParallelGet(): void {
    const gen = ++this.#generation
    this.#genAbort?.abort()
    this.#genAbort = new AbortController()
    const signal = this.#genAbort.signal
    this.#pendingGet = startParallelHistoryGet(this.#pipe, signal)
    void this.#pendingGet.then((r) => {
      if (gen !== this.#generation) return
      if (!r.ok) return
    })
  }

  async finishOpen(opening: OpeningFrame): Promise<void> {
    await finishHistoryOpen(opening, {
      port: this.#port,
      history: this.#pipe.history,
      reader: this.#reader,
      sleep: this.#sleep,
      signal: this.#genAbort?.signal ?? new AbortController().signal,
      pendingGet: this.#pendingGet,
      emitCtx: () => this.#emitCtx(),
      setWindow: (w) => {
        this.#window = w
      },
      setMetaMode: (v) => {
        this.#metaMode = v
      },
    })
  }

  async start(
    updates: ReadableStream<import("./wire/frame-decode").WireUpdateBatch>,
  ): Promise<void> {
    this.#drainAbort?.abort()
    this.#drainAbort = new AbortController()
    await drainHistoryUpdates(
      updates,
      this.#port,
      this.#gate,
      () => this.#window,
      () => this.#activeConnection,
      this.#warnedOutside,
      this.#drainAbort.signal,
    )
  }

  close(): void {
    this.#genAbort?.abort()
    this.#drainAbort?.abort()
    this.#gate.markFailed()
  }

  async loadFull(): Promise<void> {
    if (this.#reloading) return
    const gen = ++this.#reloadGeneration
    this.#genAbort?.abort()
    this.#genAbort = new AbortController()
    await loadFullHistory({
      port: this.#port,
      history: this.#pipe.history,
      gate: this.#gate,
      signal: this.#genAbort.signal,
      gen,
      reloadGeneration: this.#reloadGeneration,
      emitCtx: () => this.#emitCtx(),
      setReloading: (v) => {
        this.#reloading = v
      },
      setError: (e) => {
        this.#error = e
      },
      setWindow: (w) => {
        this.#window = w
      },
    })
  }

  async retry(): Promise<void> {
    this.#error = null
    this.#gate.open()
    emitHistoryState(this.#port, this.#emitCtx())
    await this.#triggerReload("reload")
  }

  async handleReconnected(opening: OpeningFrame, connectionId: number): Promise<void> {
    this.#activeConnection = connectionId
    const action = planReconnect(
      this.#port,
      opening,
      this.#port.getSessionId(),
      this.#port.getLastVersion(),
    )
    if (action === "legacy") {
      applyLegacyReconnect(this.#port, opening)
      return
    }
    if (action === "noop") return
    this.#port.resetReadMark()
    await this.#triggerReload(action)
    this.#port.reconnected()
  }

  async handleDriveReset(): Promise<void> {
    if (!this.#metaMode) return
    await this.#triggerReload("reset")
  }

  setConnectionId(id: number): void {
    this.#activeConnection = id
  }

  async #triggerReload(tag: "reload" | "reset"): Promise<void> {
    this.#genAbort?.abort()
    this.#genAbort = new AbortController()
    await triggerHistoryReload({
      port: this.#port,
      history: this.#pipe.history,
      gate: this.#gate,
      signal: this.#genAbort.signal,
      sleep: this.#sleep,
      emitCtx: () => this.#emitCtx(),
      setWindow: (w) => {
        this.#window = w
      },
      setReloading: (v) => {
        this.#reloading = v
      },
      setError: (e) => {
        this.#error = e
      },
      stampGen: () => ++this.#reloadGeneration,
      currentGen: () => this.#reloadGeneration,
      tag,
    })
  }

  #emitCtx(): import("./history-sync-emit").HistoryEmitCtx {
    return { window: this.#window, error: this.#error, reloading: this.#reloading }
  }
}
