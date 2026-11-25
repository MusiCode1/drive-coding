import type { SessionState } from "@drive-coding/core/session"
import { drainHistoryUpdates, HistoryGate } from "./history-drain"
import type { SettledGet } from "./history-open"
import { fetchTail } from "./history-reload"
import { finishHistoryOpen } from "./history-sync-finish"
import { loadFullHistory } from "./history-sync-load"
import type { HistorySyncPort } from "./history-sync-port"
import { applyLegacyReconnect, planReconnect } from "./history-sync-reconnect"
import { triggerHistoryReload } from "./history-sync-trigger"
import { defaultWindow, type HistoryWindow } from "./history-window"
import type { HistoryController } from "./session-view"
import type { OpeningFrame } from "./wire/frame-decode"
import type { SessionPipe } from "./wire/pipe"

export class HistorySync implements HistoryController {
  readonly #port: HistorySyncPort
  readonly #pipe: SessionPipe
  readonly #sleep: (ms: number) => Promise<void>

  #window: HistoryWindow = { firstSeq: null, lastSeq: null, hasMore: false, watermark: 0 }
  #error: string | null = null
  #reloading = false
  #gate = new HistoryGate()
  #activeConnection = 0
  #genAbort = new AbortController()
  #warnedOutside = new Set<number>()
  #metaMode = false
  #drainAbort: AbortController | null = null
  #pendingGet?: Promise<SettledGet>
  #opening = false
  #nextOpening?: { frame: OpeningFrame; connection: number }
  #reloadInput?: { tag: "reload" | "reset"; seed: SessionState }

  constructor(port: HistorySyncPort, pipe: SessionPipe, sleep: (ms: number) => Promise<void>) {
    this.#port = port
    this.#pipe = pipe
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
  #beginRequest(): AbortController {
    this.#genAbort.abort()
    this.#genAbort = new AbortController()
    return this.#genAbort
  }

  beginParallelGet(): void {
    this.#gate.open()
    this.#opening = true
    this.#pendingGet = fetchTail(this.#pipe.history, this.#beginRequest().signal)
  }

  async finishOpen(opening: OpeningFrame): Promise<void> {
    this.#metaMode = opening.historyOmitted !== undefined
    const pendingGet = this.#pendingGet
    this.#pendingGet = undefined
    if (!pendingGet) throw new Error("History opening GET not started")
    await finishHistoryOpen(opening, {
      port: this.#port,
      history: this.#pipe.history,
      sleep: this.#sleep,
      controller: this.#genAbort,
      pendingGet,
      emitCtx: () => this.#emitCtx(),
      setWindow: (w) => {
        this.#window = w
      },
    })
    this.#opening = false
    const next = this.#nextOpening
    this.#nextOpening = undefined
    if (next) void this.handleReconnected(next.frame, next.connection)
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
      () => this.#metaMode,
      () => {
        void this.handleDriveReset()
      },
    )
  }

  close(): void {
    this.#opening = false
    this.#nextOpening = undefined
    this.#pendingGet = undefined
    this.#genAbort.abort()
    this.#drainAbort?.abort()
    this.#gate.markFailed()
  }

  async loadFull(): Promise<void> {
    if (this.#reloading) return
    await loadFullHistory({
      port: this.#port,
      history: this.#pipe.history,
      gate: this.#gate,
      signal: this.#beginRequest().signal,
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
    const retry = this.#reloadInput ?? { tag: "reload", seed: this.#port.getState() }
    this.#error = null
    await this.#triggerReload(retry.tag, retry.seed)
  }

  async handleReconnected(opening: OpeningFrame, connectionId: number): Promise<void> {
    this.#activeConnection = connectionId
    if (this.#opening) {
      this.#nextOpening = { frame: opening, connection: connectionId }
      return
    }
    const action = planReconnect(opening, this.#port.getSessionId(), this.#port.getLastVersion())
    this.#metaMode = opening.historyOmitted !== undefined
    if (action === "legacy") {
      this.#genAbort.abort()
      applyLegacyReconnect(this.#port, opening)
      return
    }
    if (action === "noop") return
    this.#port.resetReadMark()
    if (await this.#triggerReload(action, opening.state)) this.#port.reconnected()
  }

  async handleDriveReset(): Promise<void> {
    if (!this.#metaMode) return
    this.#window = defaultWindow(this.#port.getLastVersion())
    this.#error = null
    this.#warnedOutside.clear()
    await this.#triggerReload("reset", this.#port.getState())
  }

  setConnectionId(id: number): void {
    this.#activeConnection = id
  }

  async #triggerReload(tag: "reload" | "reset", seed: SessionState): Promise<boolean> {
    this.#reloadInput = { tag, seed }
    return triggerHistoryReload({
      port: this.#port,
      history: this.#pipe.history,
      gate: this.#gate,
      signal: this.#beginRequest().signal,
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
      tag,
      seed,
    })
  }

  #emitCtx(): import("./history-sync-emit").HistoryEmitCtx {
    return { window: this.#window, error: this.#error, reloading: this.#reloading }
  }
}
