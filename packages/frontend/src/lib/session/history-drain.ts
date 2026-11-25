import { type Patch, reduce } from "@drive-coding/core/session"
import type { HistorySyncPort } from "./history-sync-port"
import { type HistoryWindow, isOutsideWindow, seqFromUpdate } from "./history-window"
import type { WireUpdateBatch } from "./wire/frame-decode"
import { connectionOf } from "./wire/frame-reader"

type Queued = { batch: WireUpdateBatch; connection: number }

export class HistoryGate {
  #open = true
  #failed = false
  #listeners = new Set<() => void>()

  get isOpen(): boolean {
    return this.#open
  }

  get failed(): boolean {
    return this.#failed
  }

  close(): void {
    this.#open = false
    this.#failed = false
  }

  open(): void {
    this.#open = true
    this.#failed = false
    for (const notify of this.#listeners) notify()
  }

  markFailed(): void {
    this.#failed = true
    this.#open = false
    for (const notify of this.#listeners) notify()
  }

  onChange(notify: () => void): () => void {
    this.#listeners.add(notify)
    return () => this.#listeners.delete(notify)
  }
}

export function filterBatchByWindow(
  batch: WireUpdateBatch,
  window: HistoryWindow,
  warned: Set<number>,
  port: Pick<HistorySyncPort, "warn" | "emit">,
): WireUpdateBatch | null {
  if (batch.updates.length === 0) return batch
  const kept: typeof batch.updates = []
  let droppedActivity = false
  for (const update of batch.updates) {
    const seq = seqFromUpdate(update)
    if (isOutsideWindow(seq, window)) {
      if (seq !== null && !warned.has(seq)) {
        warned.add(seq)
        port.warn("history-outside-window", { seq })
      }
      droppedActivity = true
      continue
    }
    kept.push(update)
  }
  if (droppedActivity) {
    port.emit({ patches: [], updates: [], activity: true })
  }
  if (kept.length === 0) return null
  return { version: batch.version, updates: kept }
}

function applyBatch(batch: WireUpdateBatch, port: HistorySyncPort): Patch[] {
  let state = port.getState()
  const produced: Patch[] = []
  for (const update of batch.updates) {
    const { state: next, patches } = reduce(state, update)
    state = next
    produced.push(...patches)
  }
  port.replace({ ...state, version: batch.version }, batch.version)
  for (const p of produced) port.advanceWaterMark(p)
  if (produced.length > 0 || batch.updates.length > 0) {
    port.emit({ patches: produced, updates: batch.updates })
  }
  return produced
}

export async function drainHistoryUpdates(
  stream: ReadableStream<WireUpdateBatch>,
  port: HistorySyncPort,
  gate: HistoryGate,
  window: () => HistoryWindow,
  activeConnection: () => number,
  warnedOutside: Set<number>,
  signal: AbortSignal,
  onReset: () => void,
): Promise<void> {
  const queue: Queued[] = []
  const reader = stream.getReader()
  const finished = Promise.withResolvers<void>()
  let streamDone = false
  const flush = () => {
    if (signal.aborted || (streamDone && gate.failed)) {
      queue.length = 0
      finished.resolve()
      return
    }
    if (!gate.isOpen) return
    for (const { batch, connection } of queue.splice(0)) {
      if (connection > 0 && connection < activeConnection()) continue
      if (batch.version <= port.getLastVersion()) continue
      try {
        const filtered = filterBatchByWindow(batch, window(), warnedOutside, port)
        if (!filtered) continue
        applyBatch(filtered, port)
        if (filtered.updates.some((update) => update.sessionUpdate === "_drive/reset")) onReset()
      } catch (error) {
        port.warn("history-batch-apply-failed", { error })
      }
    }
    if (streamDone) finished.resolve()
  }
  const unsubscribe = gate.onChange(flush)
  const abort = () => {
    flush()
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener("abort", abort, { once: true })
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      queue.push({ batch: value, connection: connectionOf(value) })
      flush()
    }
    streamDone = true
    flush()
    await finished.promise
  } finally {
    reader.releaseLock()
    signal.removeEventListener("abort", abort)
    unsubscribe()
  }
}
