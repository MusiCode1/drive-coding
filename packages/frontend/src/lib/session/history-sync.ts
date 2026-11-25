import type { SessionState } from "@drive-coding/core/session"
import { drainHistoryUpdates, HistoryGate } from "./history-drain"
import type { SettledGet } from "./history-open"
import { fetchTail } from "./history-reload"
import { finishHistoryOpen } from "./history-sync-finish"
import { OlderHistory } from "./history-sync-older"
import type { HistorySyncPort } from "./history-sync-port"
import { HistoryReload, planReconnect } from "./history-sync-reconnect"
import { defaultWindow, type HistoryWindow } from "./history-window"
import type { HistoryController } from "./session-view"
import type { OpeningFrame } from "./wire/frame-decode"
import type { SessionPipe } from "./wire/pipe"

export class HistorySync implements HistoryController {
  readonly #port: HistorySyncPort
  readonly #pipe: SessionPipe
  readonly #sleep: (ms: number) => Promise<void>
  readonly #older: OlderHistory
  readonly #reload: HistoryReload

  #window: HistoryWindow = { firstSeq: null, lastSeq: null, hasMore: false, watermark: 0 }
  #gate = new HistoryGate()
  #activeConnection = 0
  #genAbort = new AbortController()
  #warnedOutside = new Set<number>()
  #metaMode = false
  #drainAbort: AbortController | null = null
  #pendingGet?: Promise<SettledGet>
  #opening = false
  #nextOpening?: { frame: OpeningFrame; connection: number }

  constructor(port: HistorySyncPort, pipe: SessionPipe, sleep: (ms: number) => Promise<void>) {
    this.#port = port
    this.#pipe = pipe
    this.#sleep = sleep
    const historyCtx = {
      port,
      history: pipe.history,
      gate: this.#gate,
      emitCtx: () => this.#emitCtx(),
      setWindow: (window: HistoryWindow) => {
        this.#window = window
      },
    }
    this.#older = new OlderHistory({ ...historyCtx, signal: () => this.#genAbort.signal })
    this.#reload = new HistoryReload({ ...historyCtx, sleep })
  }

  get window(): HistoryWindow {
    return this.#window
  }
  get error(): string | null {
    return this.#reload.error
  }
  get reloading(): boolean {
    return this.#reload.reloading
  }
  get loadingOlder(): boolean {
    return this.#older.loadingOlder
  }
  get olderError(): string | null {
    return this.#older.olderError
  }
  #beginRequest(clearFloors = true): AbortController {
    this.#genAbort.abort()
    this.#older.cancel()
    if (clearFloors) this.#older.clearFloors()
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
      this.#older,
    )
  }

  close(): void {
    this.#opening = false
    this.#nextOpening = undefined
    this.#pendingGet = undefined
    this.#genAbort.abort()
    this.#older.cancel()
    this.#older.clearFloors()
    this.#drainAbort?.abort()
    this.#gate.markFailed()
  }

  loadOlder(): Promise<void> {
    return this.#older.load()
  }

  async retry(): Promise<void> {
    const retry = this.#reload.input ?? { tag: "reload", seed: this.#port.getState() }
    this.#reload.error = null
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
      this.#reload.finishLegacy(
        opening,
        () => this.#beginRequest(false),
        () => this.#older.clearFloors(),
      )
      return
    }
    if (action === "noop") return
    this.#port.resetReadMark()
    if (await this.#triggerReload(action, opening.state)) this.#port.reconnected()
  }

  async handleDriveReset(): Promise<void> {
    if (!this.#metaMode) return
    this.#window = defaultWindow(this.#port.getLastVersion())
    this.#reload.error = null
    this.#warnedOutside.clear()
    await this.#triggerReload("reset", this.#port.getState())
  }

  setConnectionId(id: number): void {
    this.#activeConnection = id
  }

  async #triggerReload(tag: "reload" | "reset", seed: SessionState): Promise<boolean> {
    return this.#reload.run({ tag, seed }, this.#beginRequest().signal)
  }

  #emitCtx(): import("./history-sync-emit").HistoryEmitCtx {
    return {
      window: this.#window,
      error: this.error,
      reloading: this.reloading,
      ...this.#older.fields(),
    }
  }
}
