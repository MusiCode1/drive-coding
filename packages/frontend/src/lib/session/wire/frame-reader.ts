import type { ChannelFrame, SessionState } from "@drive-coding/core/session"
import { connInfo, connWarn } from "$lib/util/conn-log"
import { decodeUpdateFrame, type WireUpdateBatch } from "./frame-decode"
import { type FramePipe, PipeError } from "./pipe"
import { MAX_BACKOFF_MS, ReaderWatchdog, STABLE_CONNECTION_MS } from "./reader-liveness"
import type { SSEReaderOptions } from "./reader-types"
import { snapshotWaitMs, waitForSnapshot } from "./snapshot-wait"

export class FrameReader {
  /**
   * Called after each successful reconnect, with the new snapshot.
   * Set before calling connect().
   */
  onReconnected?: (snapshot: SessionState) => void
  /**
   * slice ownership-handoff C3: called when the server sends taken-over event.
   * After this, #closed is set to true and no reconnect is attempted.
   */
  onTakenOver?: () => void

  readonly #pipe: FramePipe
  readonly #watchdog: ReaderWatchdog
  readonly #sleep: (ms: number) => Promise<void>
  readonly #now: () => number
  readonly #snapshotTimeoutMs: number
  #closed = false
  // calev-heavy M7: close() didn't abort the in-flight fetch — the underlying
  // socket/request stayed established (leaked) until the server eventually
  // noticed the client was gone (or never did). Aborting on close() releases it
  // immediately, and also unblocks any pending body reader.read() (which is what
  // makes close() actually stop an active connection promptly, not just future ones).
  #abortController: AbortController | null = null

  constructor(pipe: FramePipe, opts: Omit<SSEReaderOptions, "headers" | "_fetch"> = {}) {
    this.#pipe = pipe
    this.#sleep = opts._sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#now = opts._now ?? (() => Date.now())
    this.#watchdog = new ReaderWatchdog(pipe.describe, this.#now, opts)
    this.#snapshotTimeoutMs = snapshotWaitMs(opts._snapshotTimeoutMs)
  }

  /**
   * Connect to the frame pipe.
   * Returns the initial snapshot and a long-lived patches stream.
   * The patches stream survives reconnects (automatic exponential backoff).
   */
  async connect(): Promise<{ snapshot: SessionState; updates: ReadableStream<WireUpdateBatch> }> {
    this.#closed = false

    // Initial connection — must receive snapshot as first frame
    const { snapshot, frames } = await this.#connectOnce()
    // slice sse-liveness Commit 4: the watchdog only ever ticks AFTER a
    // snapshot was received — never during the snapshot wait itself (bounded
    // separately, above) and never during backoff (below, §runLoop).
    this.#watchdog.start(() => this.#abortController?.abort())

    // Long-lived patches stream — drained by background loop
    let patchCtrl!: ReadableStreamDefaultController<WireUpdateBatch>
    const updates = new ReadableStream<WireUpdateBatch>({
      start: (ctrl) => {
        patchCtrl = ctrl
      },
      cancel: () => {
        // slice sse-liveness Commit 4: routed through #setClosed — one of the
        // (now five) sites that set #closed=true; the watchdog must stop here
        // too, not just in close(), or it keeps ticking on a cancelled reader.
        this.#setClosed()
      },
    })

    // Background loop: drain initial frames, then reconnect-loop
    void this.#runLoop(frames, patchCtrl)

    return { snapshot, updates }
  }

  /** Stop reconnect attempts, abort any in-flight request, and close the patches stream. */
  close(): void {
    this.#setClosed()
    this.#abortController?.abort()
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Opens a connection and consumes its snapshot, leaving the same iterator
   * positioned at the subsequent update frames.
   */
  async #connectOnce(): Promise<{
    snapshot: SessionState
    frames: AsyncIterable<ChannelFrame>
  }> {
    const abortController = new AbortController()
    this.#abortController = abortController
    try {
      const source = await this.#pipe.open(abortController.signal)
      const iterator = source[Symbol.asyncIterator]()
      const snapshot = await waitForSnapshot(iterator, this.#snapshotTimeoutMs)
      return { snapshot, frames: { [Symbol.asyncIterator]: () => iterator } }
    } catch (error) {
      abortController.abort()
      throw error
    }
  }

  /**
   * runLoop — drains patches from the initial connection, then reconnects
   * indefinitely with exponential backoff until close() is called.
   */
  async #runLoop(
    frames: AsyncIterable<ChannelFrame>,
    ctrl: ReadableStreamDefaultController<WireUpdateBatch>,
  ): Promise<void> {
    // Drain initial connection patches
    await this.#drainFrames(frames, ctrl)
    // slice sse-liveness Commit 4: the connection just ended (drainFrames
    // always returns normally, never throws — see its doc comment) — no
    // watchdog while there's no open connection to watch.
    this.#watchdog.stop()

    if (this.#closed) {
      this.#closeCtrl(ctrl)
      return
    }

    // Reconnect loop
    let delay = 1000
    // סבב-תיקונים liveness: היומן [conn] נוסף כאן ולא רק במסלול ה-WS. ניתוק
    // ב-HTTP לא עובר ב-#handleUnexpectedClose בכלל, ולכן הקונסולה נשארה שקטה
    // לגמרי בזמן ניתוק אמיתי — נתפס חי בפריוויו. זה הזרם היחיד שרואה את
    // הניתוק בנתיב ה-HTTP, אז כאן מקומו.
    connWarn("sse-lost", { url: this.#pipe.describe })

    while (!this.#closed) {
      await this.#sleep(delay)
      if (this.#closed) break

      // Double delay for next attempt (before the attempt so failure doubles)
      delay = Math.min(delay * 2, MAX_BACKOFF_MS)

      try {
        const { snapshot, frames: newFrames } = await this.#connectOnce()
        if (this.#closed) break
        // slice sse-liveness Commit 4: snapshot received — watchdog resumes.
        // Symmetric with the "no watchdog during backoff" stop above.
        this.#watchdog.start(() => this.#abortController?.abort())

        const openedAt = this.#now()
        connInfo("sse-reconnected", { url: this.#pipe.describe, version: snapshot.version })

        // Notify about the new snapshot
        this.onReconnected?.(snapshot)

        // Drain patches from the reconnected connection
        await this.#drainFrames(newFrames, ctrl)
        this.#watchdog.stop() // connection ended — see the symmetric call above

        // ⚠️ איפוס ה-backoff רק לחיבור ש**שרד**, לא לכל אחד שנפתח. חיבור
        // שנסגר מיד אחרי ה-snapshot אינו הצלחה — הוא בדיוק התסמין שבגללו
        // ה-backoff קיים (ר' STABLE_CONNECTION_MS).
        const lastedMs = this.#now() - openedAt
        if (lastedMs >= STABLE_CONNECTION_MS) delay = 1000
        connWarn("sse-lost", { url: this.#pipe.describe, lastedMs })
      } catch (err) {
        // slice sse-liveness Commit 3ג: 404 mid-reconnect is a FINAL state, not
        // a transient failure. Three of the four backend reasons for 404 ARE
        // final (connection not found / dead / ws-owned-without-eviction); the
        // fourth (evict-timeout — a stuck WS tab) is 503, which falls through
        // to the retry branch below like any other transient failure. Without
        // this, a deleted agent's tab hammers GET /events every 30s forever
        // (backoff caps at 30s and never resets — every attempt fails
        // identically) — see brief §3, Commit 3ג. Only the STATUS matters
        // here, never the message text (unlike the guard in the initial
        // #connectOnce() rejection, this branch never surfaces to a test via
        // `.toThrow()`).
        if (err instanceof PipeError && err.status === 404) {
          // slice sse-liveness Commit 4: routed through #setClosed (harmless
          // no-op on the watchdog here — it was never started for a failed
          // #connectOnce — but keeps all five #closed=true sites consistent).
          this.#setClosed()
          connWarn("sse-gone", { url: this.#pipe.describe })
          break
        }
        // Connection failed — continue with next retry (delay already doubled)
        connWarn("sse-retry", { url: this.#pipe.describe, nextInMs: delay })
      }
    }

    this.#closeCtrl(ctrl)
  }

  /**
   * Drain patch frames into the controller until the generator is exhausted.
   *
   * calev-heavy B3: JSON.parse and ctrl.enqueue used to share one try/catch, so a
   * single malformed frame (bad JSON on the wire) was indistinguishable from "the
   * consumer closed the controller" — both set #closed=true and killed the reader
   * permanently (measured: one bad frame → every subsequent patch silently lost,
   * no reconnect, no error surfaced). The two failure modes are separated below:
   * a parse error just skips that one frame (draining continues); an enqueue
   * error is the real "consumer is gone" signal that should stop the reader.
   *
   * calev-heavy round 3 (root-cause fix): the parsed JSON was cast `as Patch`
   * with zero runtime validation — the actual wire boundary. Three separate
   * round 2/3 findings (unknown op wiping RemoteSessionView#state, #lastVersion
   * advancing for garbage it only "saw" rather than a patch it actually applied)
   * were all downstream symptoms of trusting this cast. Validated here with
   * PatchSchema (ArkType) before a patch is ever enqueued — an invalid patch
   * never reaches the consumer at all, so its version can never be used for
   * anything.
   */
  async #drainFrames(
    frames: AsyncIterable<ChannelFrame>,
    ctrl: ReadableStreamDefaultController<WireUpdateBatch>,
  ): Promise<void> {
    try {
      for await (const frame of frames) {
        if (this.#closed) return
        // slice sse-liveness Commit 4: EVERY frame counts as traffic — heartbeat
        // (stream-alive) AND patch alike (§Commit 4 of the brief: "תעבורה היא
        // תעבורה"). Touched before the event-kind branching below so an
        // unrecognized future event type still resets the watchdog too.
        this.#watchdog.touch()
        // slice ownership-handoff C3: taken-over signals a terminal end — stop reconnecting
        if (frame.event === "taken-over") {
          this.#setClosed() // slice sse-liveness Commit 4: was a bare #closed=true
          this.onTakenOver?.()
          return
        }
        if (frame.event !== "update") continue

        const decoded = decodeUpdateFrame(frame)
        if (decoded.kind !== "batch") {
          if (decoded.kind === "invalid-batch") {
            console.warn("SSEReader: malformed session/update batch on wire, skipping")
          } else if (decoded.kind === "invalid-id") {
            console.warn("SSEReader: update frame without a usable id, skipping")
          }
          continue
        }

        try {
          ctrl.enqueue(decoded.batch)
        } catch {
          // Controller closed by consumer — stop. slice sse-liveness Commit 4:
          // routed through #setClosed (was a bare #closed=true).
          this.#setClosed()
          return
        }
      }
    } catch {
      // Stream read error — caller will trigger reconnect
    }
  }

  #closeCtrl(ctrl: ReadableStreamDefaultController<WireUpdateBatch>): void {
    try {
      ctrl.close()
    } catch {
      // Already closed
    }
  }

  /**
   * setClosed — the ONE place that sets `#closed = true`. Centralizes the
   * (now five) call sites that used to set it directly and each forgot to
   * also stop the watchdog: `cancel()`, `close()`, `taken-over`,
   * `ctrl.enqueue` throwing, and the 404-mid-reconnect final state (Commit
   * 3ג). A watchdog left running past any of these keeps ticking forever —
   * "מרעיב את ה-worker של vitest" in tests, and a real leaked timer in
   * production.
   */
  #setClosed(): void {
    this.#closed = true
    this.#watchdog.stop()
  }
}
