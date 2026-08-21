/**
 * sse-reader.ts — SSEReader: fetch + ReadableStream SSE client with manual reconnect.
 *
 * לא משתמש ב-EventSource (לא תומך ב-POST/headers).
 * מתחבר עם fetch + ReadableStream, מנתח SSE framing ידנית.
 *
 * Protocol:
 *   event: snapshot\nid: <version>\ndata: {sessionId,version,epoch,updates[]}  ← frame-zero
 *   event: update\nid: <version>\ndata: <JSON-RPC batch של session/update>   ← עדכונים שוטפים
 *   event: stream-alive\ndata: <_drive/streamAlive notification>\n\n  ← slice sse-liveness
 *                                                                   Commit 2: visible liveness
 *                                                                   signal (replaces the old,
 *                                                                   invisible `: keepalive`
 *                                                                   SSE comment). Ignored by
 *                                                                   this parser's event-name
 *                                                                   switch (falls through like
 *                                                                   any unknown event) until
 *                                                                   Commit 4 wires the watchdog.
 *   event: taken-over\nid: <new-epoch>\ndata: {}\n\n            ← terminal: stop reconnecting
 *
 * Reconnect: exponential backoff (1s, 2s, 4s, ..., max 30s).
 * On reconnect: calls onReconnected(newSnapshot) before resuming patches.
 *
 * ─── slice remote-session-view C1 (TDD) ───
 */

import {
  createInitialSessionState,
  reduce,
  type SessionState,
  type WireSessionUpdate,
} from "@drive-coding/core/session"
import { SSE_WATCHDOG_THRESHOLD_MS } from "$lib/engines/liveness-thresholds"
import { connInfo, connWarn } from "$lib/util/conn-log"

// ─── SSE frame parsing ────────────────────────────────────────────────────────

/**
 * יחידת-המעבר על החוט — ‏slice acp-wire-session-update.
 *
 * ⚠️ **מערך, לא update יחיד.** מעבר-מצב אחד בשרת (patch אחד) יכול להתפצל
 * לכמה `session/update` — למשל `update-session` עם title+commands. כולם
 * חולקים את אותו `version`, ולכן פיצולם לפריימים נפרדים היה שובר את
 * סינון-החפיפה (`version <= lastVersion`) שהיה מוחק את השני והשלישי.
 * ⇒ הפריים הוא היחידה האטומית; ה-`version` שלו מגיע משורת ה-`id:`.
 */
export type WireUpdateBatch = { version: number; updates: WireSessionUpdate[] }

/** גוף ה-snapshot (frame-zero). */
type WireSnapshot = {
  sessionId: string | null
  version: number
  updates: WireSessionUpdate[]
}

/**
 * מחלץ את ה-updates מ-batch של JSON-RPC.
 *
 * ⚠️ **הוולידציה כאן רופפת במכוון, וזה לא רשלנות.** קודמתה (`PatchSchema`)
 * יכלה להיות הדוקה כי `Patch` הוא טיפוס סגור שלנו; `session/update` הוא
 * משטח **פתוח** — הפרוטוקול עצמו מצהיר שערכי `sessionUpdate` לא-מוכרים
 * שמורים לווריאנטים עתידיים, וזה בדיוק מה שנושא את `plan` דרך ה-BE בלי
 * שיבין אותו. סכימה הדוקה כאן הייתה **מוחקת** אותם — אותה מחלקת-כשל
 * שהתיקון `opaque` נועד לסגור. ⇒ נבדק רק המסגור: מערך, ובכל איבר
 * `params.update` שהוא אובייקט עם `sessionUpdate` מחרוזתי.
 */
function extractUpdates(raw: unknown): WireSessionUpdate[] | null {
  if (!Array.isArray(raw)) return null
  const out: WireSessionUpdate[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null
    const params = (item as { params?: unknown }).params
    if (typeof params !== "object" || params === null) return null
    const update = (params as { update?: unknown }).update
    if (typeof update !== "object" || update === null) return null
    if (typeof (update as { sessionUpdate?: unknown }).sessionUpdate !== "string") return null
    out.push(update as WireSessionUpdate)
  }
  return out
}

/** מקפל את ה-snapshot למצב. ה-`version` נלקח מהשרת, לא מספירת ה-updates. */
function foldSnapshot(snap: WireSnapshot): SessionState {
  let state = createInitialSessionState({ sessionId: snap.sessionId ?? "" })
  for (const u of snap.updates) state = reduce(state, u).state
  // ⚠️ **דריסה מכוונת.** `reduce` מעלה מונה מקומי לכל update, אבל ה-`version`
  // הוא מונה של **השרת** — הוא מה שסימון-החפיפה של הלקוח נמדד מולו. ספירה
  // מקומית הייתה מייצרת בדיוק את רגרסיית-הגרסה שבאג #41 נבנה סביבה.
  return { ...state, sessionId: snap.sessionId, version: snap.version }
}

type SSEFrame = { event: string; data: string; id: string }

/**
 * readSSEFrames — async generator that yields parsed SSE frames from a body stream.
 * Handles CRLF and LF line endings. Releases reader lock on completion/error.
 */
async function* readSSEFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  let currentData = ""
  // slice acp-wire-session-update: ה-`id:` נקרא עכשיו, כי הוא נושא את
  // ה-`version` — שירד מגוף ה-patch אל שורת-המסגור. עד כה הוא פשוט נזרק.
  let currentId = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Split on LF; keep the last incomplete line in the buffer
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const rawLine of lines) {
        // Strip trailing CR (CRLF → LF normalisation)
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine

        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          currentData += line.slice(5).trim()
        } else if (line.startsWith("id:")) {
          currentId = line.slice(3).trim()
        } else if (line === "") {
          // Empty line → dispatch event
          if (currentEvent && currentData) {
            yield { event: currentEvent, data: currentData, id: currentId }
          }
          currentEvent = ""
          currentData = ""
          currentId = ""
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Already released
    }
  }
}

// ─── SSEReader ────────────────────────────────────────────────────────────────

/** Options for SSEReader constructor. */
export type SSEReaderOptions = {
  /** HTTP headers to include in every fetch request (e.g. Authorization). */
  headers?: Record<string, string>
  /** @internal For testing — override global fetch. */
  _fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** @internal For testing — override setTimeout-based sleep. */
  _sleep?: (ms: number) => Promise<void>
  /** @internal For testing — override the clock used to measure connection lifetime. */
  _now?: () => number
  /**
   * @internal For testing — override the silence-watchdog's timer scheduler.
   * slice sse-liveness Commit 4a/4: same seam pattern as `_fetch`/`_sleep`/
   * `_now` — default = the real global, so production is unchanged.
   */
  _setInterval?: typeof setInterval
  /** @internal For testing — override the silence-watchdog's timer cancel. */
  _clearInterval?: typeof clearInterval
  /**
   * @internal For testing — override the snapshot-wait bound (default
   * `SNAPSHOT_TIMEOUT_MS`). Deliberately a plain number, not a `_sleep`-style
   * function seam: reusing `_sleep` here would make the timeout win EVERY
   * race instantly in the many existing tests that mock `_sleep` as an
   * instant no-op (it represents backoff delay, not this). A real (but tiny,
   * test-only) delay lets the timeout test use REAL timers instead of
   * `vi.useFakeTimers()` racing a `Promise.race` across several `await`
   * hops — a combination that produced spurious `PromiseRejectionHandled
   * Warning` noise (harmless per Node's own docs, but still noise) in this
   * exact codebase/runtime combination.
   */
  _snapshotTimeoutMs?: number
}

/** Maximum reconnect delay (ms). */
const MAX_BACKOFF_MS = 30_000

/**
 * slice sse-liveness Commit 4: bounded wait for the `snapshot` frame-zero. A
 * connection that opens successfully (fetch resolves ok) but never sends
 * `snapshot` — a misbehaving proxy, or a host that accepts the request and
 * writes nothing — used to hang `#connectOnce` FOREVER: outside the patches
 * loop entirely, so the silence-watchdog below can never see it, and (for the
 * very first connection) before `#runLoop` even exists, so nothing would
 * ever retry. Unrelated to `SSE_WATCHDOG_THRESHOLD_MS` (that one bounds
 * silence on an ALREADY-open stream, after the snapshot) — this bounds the
 * initial handshake itself, so it's deliberately much shorter.
 */
const SNAPSHOT_TIMEOUT_MS = 15_000

/**
 * כמה זמן חיבור חייב לשרוד כדי שייחשב "הצלחה" לצורך איפוס ה-backoff.
 *
 * 🔴 נצפה חי (2026-08-16, ניתוק-קשה): `connectOnce` הצליח, ה-snapshot התקבל,
 * והחיבור נסגר **מיד** (`ERR_CONNECTION_CLOSED`). מכיוון שה-delay אופס ברגע
 * שהחיבור נפתח — לפני שידוע אם ישרוד — נוצרה לולאה צמודה: ניסיון כל שנייה,
 * בלי שום הסלמה, לנצח. בלוג נראו שני `sse-reconnected version=111` רצופים
 * עם `nextInMs=2000` ביניהם, בעוד כשלים *אמיתיים* כן הסלימו עד 16000.
 *
 * ⇒ שרת שמקבל-וסוגר (502 של Cloudflare · LB באמצע דיפלוי · פרוקסי שנופל)
 * הוא בדיוק המקרה שבו backoff נחוץ, והוא היחיד שבו הוא לא פעל.
 */
const STABLE_CONNECTION_MS = 10_000

/**
 * SSEReader — reads an SSE endpoint using fetch + ReadableStream.
 *
 * Usage:
 *   const reader = new SSEReader('/api/agents/a1/events', { headers: {...} })
 *   const { snapshot, patches } = await reader.connect()
 *   // patches is ReadableStream<WireUpdateBatch> — individual patches
 *   reader.close()  // when done
 */
export class SSEReader {
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

  readonly #url: string
  readonly #headers: Record<string, string>
  readonly #doFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly #sleep: (ms: number) => Promise<void>
  readonly #now: () => number
  readonly #doSetInterval: typeof setInterval
  readonly #doClearInterval: typeof clearInterval
  readonly #snapshotTimeoutMs: number
  #closed = false
  // calev-heavy M7: close() didn't abort the in-flight fetch — the underlying
  // socket/request stayed established (leaked) until the server eventually
  // noticed the client was gone (or never did). Aborting on close() releases it
  // immediately, and also unblocks any pending body reader.read() (which is what
  // makes close() actually stop an active connection promptly, not just future ones).
  #abortController: AbortController | null = null

  // ─── slice sse-liveness Commit 4: silence-watchdog ─────────────────────────
  // Timestamp of the last frame received on the CURRENT connection (heartbeat
  // OR patch — traffic is traffic, §Commit 4 of the brief). Only meaningful
  // while `#watchdogTimer` is running (i.e. while a connection is open).
  #lastFrameAt = 0
  #watchdogTimer: ReturnType<typeof setInterval> | null = null

  constructor(url: string, opts: SSEReaderOptions = {}) {
    this.#url = url
    this.#headers = opts.headers ?? {}
    this.#doFetch = opts._fetch ?? ((u, init) => globalThis.fetch(u, init))
    this.#sleep = opts._sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#now = opts._now ?? (() => Date.now())
    this.#doSetInterval = opts._setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
    this.#doClearInterval = opts._clearInterval ?? ((id) => globalThis.clearInterval(id))
    this.#snapshotTimeoutMs = opts._snapshotTimeoutMs ?? SNAPSHOT_TIMEOUT_MS
  }

  /**
   * Connect to the SSE endpoint.
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
    this.#startWatchdog()

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
   * connectOnce — opens one SSE connection, reads until snapshot frame, returns
   * the snapshot and the remaining frame generator (for subsequent patch frames).
   */
  async #connectOnce(): Promise<{
    snapshot: SessionState
    frames: AsyncGenerator<SSEFrame>
  }> {
    this.#abortController = new AbortController()
    const res = await this.#doFetch(this.#url, {
      headers: this.#headers,
      signal: this.#abortController.signal,
    })
    if (!res.ok) {
      // slice sse-liveness Commit 3ג: carries `status` as a real field (not just
      // baked into the message string) so #runLoop's catch can branch on it —
      // 404 is a FINAL state (the agent is gone), 500/503 are not. The message
      // text is left unchanged (still contains "404" etc.) — an existing test
      // (`rejects.toThrow("404")` on the initial connection) asserts on it.
      const err = new Error(`SSEReader: fetch failed with status ${res.status}`) as Error & {
        status: number
      }
      err.status = res.status
      throw err
    }
    if (!res.body) {
      throw new Error("SSEReader: response has no body")
    }

    const frames = readSSEFrames(res.body)
    const snapshot = await this.#waitForSnapshot(frames)
    return { snapshot, frames }
  }

  /**
   * waitForSnapshot — advances past any non-snapshot frames to find the
   * required snapshot frame-zero, bounded by `SNAPSHOT_TIMEOUT_MS` (see its
   * doc comment for why: a connection that never sends `snapshot` used to
   * hang here forever, invisible to both the watchdog and — on the initial
   * connection — the reconnect loop).
   *
   * ⚠️ Deliberately uses the RAW global `setTimeout`/`clearTimeout`, not the
   * `#sleep` seam: `#sleep` is mocked as an INSTANT no-op in almost every
   * test in this file (it represents backoff delay, which tests skip) — if
   * this raced against `this.#sleep(SNAPSHOT_TIMEOUT_MS)`, the timeout branch
   * would win EVERY race immediately, breaking every existing test. The raw
   * timer is safe here because `advance` below always resolves within a few
   * microtasks in every test that isn't specifically testing this timeout
   * (which uses `vi.useFakeTimers()` to fast-forward it) — the real 15s timer
   * never actually fires, and is always cleared once the race settles.
   */
  async #waitForSnapshot(frames: AsyncGenerator<SSEFrame>): Promise<SessionState> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = (async (): Promise<never> => {
      await new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, this.#snapshotTimeoutMs)
      })
      throw new Error("SSEReader: timed out waiting for snapshot frame")
    })()
    const advance = (async (): Promise<SessionState> => {
      let next = await frames.next()
      while (!next.done && next.value.event !== "snapshot") {
        next = await frames.next()
      }
      if (next.done || next.value.event !== "snapshot") {
        throw new Error("SSEReader: no snapshot frame received")
      }
      return foldSnapshot(JSON.parse(next.value.data) as WireSnapshot)
    })()
    // Both sides get a no-op `.catch` attached IMMEDIATELY (same tick, before
    // racing) — whichever one LOSES the race may still reject later on its
    // own (e.g. `advance` rejecting after `close()` aborts, post-timeout;
    // or — in principle — `timeout` firing after `advance` already won).
    // `Promise.race` never attaches a handler to the losing side, so without
    // this a later rejection is "unhandled" even though nothing is meant to
    // observe it anymore. `Promise.race([advance, timeout])` below still
    // independently determines the actual return value.
    advance.catch(() => {})
    timeout.catch(() => {})
    try {
      return await Promise.race([advance, timeout])
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * runLoop — drains patches from the initial connection, then reconnects
   * indefinitely with exponential backoff until close() is called.
   */
  async #runLoop(
    frames: AsyncGenerator<SSEFrame>,
    ctrl: ReadableStreamDefaultController<WireUpdateBatch>,
  ): Promise<void> {
    // Drain initial connection patches
    await this.#drainFrames(frames, ctrl)
    // slice sse-liveness Commit 4: the connection just ended (drainFrames
    // always returns normally, never throws — see its doc comment) — no
    // watchdog while there's no open connection to watch.
    this.#stopWatchdog()

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
    connWarn("sse-lost", { url: this.#url })

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
        this.#startWatchdog()

        const openedAt = this.#now()
        connInfo("sse-reconnected", { url: this.#url, version: snapshot.version })

        // Notify about the new snapshot
        this.onReconnected?.(snapshot)

        // Drain patches from the reconnected connection
        await this.#drainFrames(newFrames, ctrl)
        this.#stopWatchdog() // connection ended — see the symmetric call above

        // ⚠️ איפוס ה-backoff רק לחיבור ש**שרד**, לא לכל אחד שנפתח. חיבור
        // שנסגר מיד אחרי ה-snapshot אינו הצלחה — הוא בדיוק התסמין שבגללו
        // ה-backoff קיים (ר' STABLE_CONNECTION_MS).
        const lastedMs = this.#now() - openedAt
        if (lastedMs >= STABLE_CONNECTION_MS) delay = 1000
        connWarn("sse-lost", { url: this.#url, lastedMs })
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
        const status =
          err instanceof Error ? (err as Error & { status?: number }).status : undefined
        if (status === 404) {
          // slice sse-liveness Commit 4: routed through #setClosed (harmless
          // no-op on the watchdog here — it was never started for a failed
          // #connectOnce — but keeps all five #closed=true sites consistent).
          this.#setClosed()
          connWarn("sse-gone", { url: this.#url })
          break
        }
        // Connection failed — continue with next retry (delay already doubled)
        connWarn("sse-retry", { url: this.#url, nextInMs: delay })
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
    frames: AsyncGenerator<SSEFrame>,
    ctrl: ReadableStreamDefaultController<WireUpdateBatch>,
  ): Promise<void> {
    try {
      for await (const frame of frames) {
        if (this.#closed) return
        // slice sse-liveness Commit 4: EVERY frame counts as traffic — heartbeat
        // (stream-alive) AND patch alike (§Commit 4 of the brief: "תעבורה היא
        // תעבורה"). Touched before the event-kind branching below so an
        // unrecognized future event type still resets the watchdog too.
        this.#touchWatchdog()
        // slice ownership-handoff C3: taken-over signals a terminal end — stop reconnecting
        if (frame.event === "taken-over") {
          this.#setClosed() // slice sse-liveness Commit 4: was a bare #closed=true
          this.onTakenOver?.()
          return
        }
        if (frame.event !== "update") continue

        let raw: unknown
        try {
          raw = JSON.parse(frame.data)
        } catch {
          // Malformed JSON on the wire — skip it, keep draining subsequent frames.
          continue
        }

        const updates = extractUpdates(raw)
        if (updates === null) {
          console.warn("SSEReader: malformed session/update batch on wire, skipping")
          continue
        }
        // ⚠️ ה-`version` מגיע מ-`id:` ולא מהגוף. פריים בלי `id` תקין אינו
        // ניתן לסינון-חפיפה, ולכן הוא מסוכן יותר מפריים חסר — הוא היה
        // נספר כ-0 ונדחה לנצח מול כל watermark. ⇒ לדלג במפורש.
        const version = Number(frame.id)
        if (!Number.isFinite(version)) {
          console.warn("SSEReader: update frame without a usable id, skipping")
          continue
        }

        try {
          ctrl.enqueue({ version, updates })
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

  // ─── slice sse-liveness Commit 4: silence-watchdog ─────────────────────────
  //
  // The server already emits a visible liveness signal every 30s (Commit 2's
  // `event: stream-alive`) — but nothing ever CONSUMED it: a stream that stays
  // open and goes silent never triggers `#drainFrames` to end, so `#runLoop`'s
  // reconnect logic (already complete — backoff, onReconnected, stable-
  // connection reset) never runs. This watchdog is the missing trigger: it
  // tracks the timestamp of the last frame RECEIVED (any frame — heartbeat or
  // patch), and if too much time passes with nothing arriving, it aborts the
  // in-flight request WITHOUT setting `#closed` — the exact same shape as an
  // unexpected network drop, so it flows through the SAME reconnect path that
  // already exists, unchanged.

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
    this.#stopWatchdog()
  }

  /**
   * startWatchdog — called ONLY after a snapshot was actually received (both
   * on the initial connect and on every successful reconnect — never during
   * the snapshot wait itself, and never during backoff: "בזמן ה-backoff אין
   * זרם בדין; גלאי שירוץ שם יפעיל abort על חיבור שעוד לא נולד").
   *
   * Idempotent: always clears any previous timer first, so a stray double-
   * call can't leak a second interval.
   */
  #startWatchdog(): void {
    this.#stopWatchdog()
    this.#lastFrameAt = this.#now()
    // Ticks at the SAME cadence as the threshold itself — deliberately reuses
    // SSE_WATCHDOG_THRESHOLD_MS instead of introducing a second, separate
    // "how often do we check" magic number. Worst-case detection latency is
    // just under 2x the threshold (a silence that starts right after a tick
    // is caught on the NEXT tick) — acceptable for a last-resort backstop
    // whose only alternative today is an infinite hang.
    this.#watchdogTimer = this.#doSetInterval(() => {
      const silentMs = this.#now() - this.#lastFrameAt
      if (silentMs < SSE_WATCHDOG_THRESHOLD_MS) return
      connWarn("sse-silent", { url: this.#url, silentMs })
      // Abort WITHOUT #closed — #drainFrames's catch-all swallows the abort
      // error and returns normally (see its doc comment), #runLoop sees
      // #closed is still false, and falls straight into the existing
      // reconnect loop. Three lines, no new reconnect logic.
      this.#abortController?.abort()
    }, SSE_WATCHDOG_THRESHOLD_MS)
  }

  #stopWatchdog(): void {
    if (this.#watchdogTimer !== null) {
      this.#doClearInterval(this.#watchdogTimer)
      this.#watchdogTimer = null
    }
  }

  /** Called on EVERY frame drained — heartbeat and patch alike (traffic is traffic). */
  #touchWatchdog(): void {
    this.#lastFrameAt = this.#now()
  }
}
