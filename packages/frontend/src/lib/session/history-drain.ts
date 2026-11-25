import { type Patch, reduce } from "@drive-coding/core/session"
import type { HistorySyncPort } from "./history-sync-port"
import { type HistoryWindow, isOutsideWindow, seqFromUpdate } from "./history-window"
import type { WireUpdateBatch } from "./wire/frame-decode"
import { connectionOf } from "./wire/frame-reader"

type Queued = { batch: WireUpdateBatch; connection: number }

export class HistoryGate {
  #open = true
  #failed = false
  #waiters: Array<() => void> = []

  get isOpen(): boolean {
    return this.#open && !this.#failed
  }

  get failed(): boolean {
    return this.#failed
  }

  close(): void {
    this.#open = false
  }

  open(): void {
    this.#open = true
    const wake = this.#waiters.splice(0)
    for (const w of wake) w()
  }

  markFailed(): void {
    this.#failed = true
    this.#open = false
    const wake = this.#waiters.splice(0)
    for (const w of wake) w()
  }

  async wait(): Promise<void> {
    if (this.#open && !this.#failed) return
    await new Promise<void>((resolve) => this.#waiters.push(resolve))
  }
}

export function filterBatchByWindow(
  batch: WireUpdateBatch,
  window: HistoryWindow,
  warned: Set<number>,
  port: Pick<HistorySyncPort, "warn" | "emit">,
): WireUpdateBatch | null {
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
  if (batch.version <= port.getLastVersion()) return []
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
): Promise<void> {
  const queue: Queued[] = []
  let streamDone = false
  const reader = stream.getReader()

  const readLoop = (async () => {
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          queue.push({ batch: value, connection: connectionOf(value) })
        }
      }
    } finally {
      reader.releaseLock()
    }
    streamDone = true
  })()

  const applyLoop = (async () => {
    while (!signal.aborted) {
      if (queue.length === 0) {
        if (streamDone) return
        await new Promise<void>((r) => setTimeout(r, 0))
        continue
      }
      const item = queue.shift()
      if (!item) continue
      const active = activeConnection()
      if (item.connection > 0 && item.connection < active) continue
      if (gate.failed && streamDone) return
      await gate.wait()
      if (signal.aborted) return
      const filtered = filterBatchByWindow(item.batch, window(), warnedOutside, port)
      if (!filtered) continue
      try {
        applyBatch(filtered, port)
      } catch (error) {
        console.warn("RemoteSessionView: error applying patch, skipping", error)
      }
    }
  })()

  await Promise.all([readLoop, applyLoop])
}
