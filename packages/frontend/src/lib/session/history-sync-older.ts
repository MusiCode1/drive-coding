import {
  HISTORY_PAGE_BYTES_DEFAULT,
  reduce,
  type SessionState,
  type WireSessionUpdate,
} from "@drive-coding/core/session"
import type { HistoryGate } from "./history-drain"
import { historyPage, settleGet } from "./history-open"
import { emitHistoryState, type HistoryEmitCtx } from "./history-sync-emit"
import type { HistorySyncPort } from "./history-sync-port"
import { type HistoryWindow, mergeOlder } from "./history-window"
import type { HistoryPipe } from "./wire/pipe"

const OLDER_HOLD_MAX = 500
type HeldUpdate = { update: WireSessionUpdate; seq: number; version: number }
type Floor = { firstSeq: number; before: number; version: number }

type OlderHistoryOptions = {
  port: HistorySyncPort
  history: HistoryPipe
  gate: HistoryGate
  signal: () => AbortSignal
  emitCtx: () => HistoryEmitCtx
  setWindow: (window: HistoryWindow) => void
}

export class OlderHistory {
  #pending?: Promise<void>
  #held?: { updates: HeldUpdate[]; overflow: boolean }
  #floors: Floor[] = []
  #error: string | null = null

  constructor(private readonly opts: OlderHistoryOptions) {}

  get loadingOlder(): boolean {
    return this.#held !== undefined
  }

  get olderError(): string | null {
    return this.#error
  }

  fields(): Pick<HistoryEmitCtx, "loadingOlder" | "olderError"> {
    return { loadingOlder: this.loadingOlder, olderError: this.olderError }
  }

  load(): Promise<void> {
    if (this.#pending) return this.#pending
    const pending = this.#load().finally(() => {
      if (this.#pending === pending) this.#pending = undefined
    })
    this.#pending = pending
    return pending
  }

  cancel(): void {
    if (this.#held) this.#pending = undefined
    this.#held = undefined
    this.#error = null
  }

  clearFloors(): void {
    this.#floors = []
  }

  retainFloors(before?: number): void {
    if (before === undefined) {
      this.clearFloors()
      return
    }
    this.#floors = this.#floors
      .filter((floor) => floor.firstSeq < before)
      .map((floor) => ({ ...floor, before: Math.min(floor.before, before) }))
  }

  hold(update: WireSessionUpdate, seq: number, version: number): boolean {
    const held = this.#held
    if (!held) return false
    if (held.updates.length < OLDER_HOLD_MAX) held.updates.push({ update, seq, version })
    else held.overflow = true
    return true
  }

  covered(seq: number, version: number): boolean {
    return this.#floors.some(
      (floor) => seq >= floor.firstSeq && seq < floor.before && version <= floor.version,
    )
  }

  async #load(): Promise<void> {
    const { port, history, gate, emitCtx, setWindow } = this.opts
    try {
      do {
        await gate.waitOrFail()
      } while (!gate.isOpen)
    } catch {
      return
    }
    const { window } = emitCtx()
    const before = window.firstSeq
    if (!window.hasMore || before === null) return
    const signal = this.opts.signal()
    if (signal.aborted) return
    this.#error = null
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const held = { updates: [] as HeldUpdate[], overflow: false }
        this.#held = held
        if (attempt === 0) emitHistoryState(port, emitCtx())
        const settled = await settleGet(
          history.get({ before, maxBytes: HISTORY_PAGE_BYTES_DEFAULT }, signal),
        )
        if (signal.aborted) return
        const page = historyPage(settled)
        if (!page) break
        const previous = port.getState()
        const merged = mergeOlder(previous, window, page)
        if (held.overflow || "conflict" in merged || merged.window.firstSeq === null) continue
        const floor = { firstSeq: merged.window.firstSeq, before, version: page.version }
        // The page can be ahead of the stream, whose watermark still governs live batches.
        const version = port.getLastVersion()
        const state = { ...applyHeld(merged.state, held.updates, floor), version }
        this.#floors.push(floor)
        port.replace(state, version)
        setWindow(merged.window)
        this.#held = undefined
        port.emit({
          patches: [],
          updates: [],
          history: "older",
          messages: state.messages.slice(
            0,
            merged.state.messages.length - previous.messages.length,
          ),
          historyState: emitCtx(),
        })
        return
      }
    } catch (error) {
      port.warn("history-older-load-failed", { error })
    }
    if (signal.aborted) return
    this.#held = undefined
    this.#error = "history older load failed — retry"
    emitHistoryState(port, emitCtx())
  }
}

function applyHeld(state: SessionState, updates: HeldUpdate[], floor: Floor): SessionState {
  let merged = state
  for (const { update, seq, version } of updates.sort((a, b) => a.version - b.version)) {
    if (seq >= floor.firstSeq && seq < floor.before && version > floor.version) {
      merged = reduce(merged, update).state
    }
  }
  return merged
}
