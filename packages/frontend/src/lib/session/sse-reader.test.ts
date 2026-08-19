/**
 * sse-reader.test.ts — TDD עבור SSEReader (C1).
 *
 * Testing: tdd (brief §C1)
 *
 * Tests:
 *   - snapshot parsing from event: snapshot frame
 *   - headers forwarded to fetch
 *   - fetch failure throws
 *   - patch emission from event: patch frames
 *   - non-patch/snapshot events are ignored
 *   - reconnect after stream end: onReconnected called with new snapshot
 *   - exponential backoff: 1s → 2s → 4s → 8s
 *   - backoff capped at 30s
 *   - delay resets to 1s after successful reconnect
 */

import type { Patch, SessionState } from "@drive-coding/core/session"
import { createInitialSessionState } from "@drive-coding/core/session"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SSE_WATCHDOG_THRESHOLD_MS } from "$lib/engines/liveness-thresholds"
import { SSEReader, type SSEReaderOptions } from "./sse-reader.js"

// ── helpers ──────────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

/**
 * Tracks every SSEReader created via `newReader()` so `afterEach` can close
 * it — otherwise the background reconnect loop (`#runLoop`) keeps running
 * after the test ends. With a no-op `_sleep` and a mock `fetch` that
 * resolves instantly, an un-closed reader spins in a tight microtask loop
 * forever and starves the vitest worker (observed: worker never settles,
 * "Timeout terminating forks worker").
 */
const activeReaders: SSEReader[] = []

function newReader(url: string, opts: SSEReaderOptions = {}): SSEReader {
  const reader = new SSEReader(url, opts)
  activeReaders.push(reader)
  return reader
}

afterEach(() => {
  for (const reader of activeReaders) reader.close()
  activeReaders.length = 0
})

/** Build a ReadableStream<Uint8Array> that emits the given SSE frames and closes. */
function makeSSEBody(frames: Array<{ event: string; data: string }>): ReadableStream<Uint8Array> {
  const text = frames.map((f) => `event: ${f.event}\ndata: ${f.data}\n\n`).join("")
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(encoder.encode(text))
      ctrl.close()
    },
  })
}

function makeSSEResponse(frames: Array<{ event: string; data: string }>): Response {
  return {
    ok: true,
    status: 200,
    body: makeSSEBody(frames),
  } as unknown as Response
}

/**
 * makeAbortableSSEBody — like `makeSSEBody`, but the returned stream actually
 * honors `init.signal`: `makeSSEBody`/`makeSSEResponse` above IGNORE it
 * entirely — `sse-reader.test.ts` here and `remote-session-view.test.ts`'s
 * `sseBody(frames, {keepOpen})` fixture (which THIS one is lifted/extended
 * from — same "don't auto-close the stream" technique) — so `close()`'s
 * `AbortController.abort()` never actually unblocks a pending
 * `reader.read()` inside `readSSEFrames`. Real fetch/undici behavior on an
 * aborted request is to REJECT the pending body read with an AbortError —
 * mimicked here via `controller.error(...)`.
 *
 * slice sse-liveness Commit 4a.
 */
function makeAbortableSSEBody(
  frames: Array<{ event: string; data: string }>,
  opts: { keepOpen?: boolean } = {},
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const text = frames.map((f) => `event: ${f.event}\ndata: ${f.data}\n\n`).join("")
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
      ctrl.enqueue(encoder.encode(text))
      if (!opts.keepOpen) ctrl.close()
    },
  })
  signal?.addEventListener("abort", () => {
    try {
      ctrl.error(new DOMException("The operation was aborted.", "AbortError"))
    } catch {
      // already closed/errored
    }
  })
  return stream
}

function makeAbortableSSEResponse(
  frames: Array<{ event: string; data: string }>,
  opts: { keepOpen?: boolean } = {},
  signal?: AbortSignal,
): Response {
  return {
    ok: true,
    status: 200,
    body: makeAbortableSSEBody(frames, opts, signal),
  } as unknown as Response
}

/**
 * makeControlledClock — a genuinely externally-advanced fake clock: `now()`
 * returns whatever `advance()` last set it to, and reading it never itself
 * moves time forward (unlike the old `advancingNow` counter below, which adds
 * a fixed step on EVERY call — including calls that don't represent real
 * elapsed time). New in Commit 4a for Commit 4's watchdog tests, which will
 * call `#now()` far more often than the two call-sites (`openedAt`/`lastedMs`)
 * that exist today — a per-read auto-incrementing fake would corrupt THEIR
 * elapsed-time measurements. See the "resets delay to 1s" test below for why
 * the OLD counter-based `advancingNow` is intentionally left as-is (r7: "זו
 * היגיינה, לא חסם" — hygiene, not a blocker — rewriting it risks the exact
 * live regression it locks: `STABLE_CONNECTION_MS`, 2026-08-16).
 */
function makeControlledClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

/**
 * makeControllableSSEBody — a raw byte stream the TEST can push individual
 * SSE frames into incrementally (unlike makeSSEBody/makeAbortableSSEBody,
 * which enqueue everything upfront in `start()`). Needed for the Commit 4
 * watchdog tests, which need to simulate heartbeats arriving OVER TIME on an
 * already-open connection — honors `signal` the same way makeAbortableSSEBody
 * does (AbortError on the pending read).
 */
function makeControllableSSEBody(signal?: AbortSignal): {
  body: ReadableStream<Uint8Array>
  push: (frame: { event: string; data: string }) => void
  close: () => void
} {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
  })
  signal?.addEventListener("abort", () => {
    try {
      ctrl.error(new DOMException("The operation was aborted.", "AbortError"))
    } catch {
      // already closed/errored
    }
  })
  return {
    body,
    push: (frame) => {
      try {
        ctrl.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${frame.data}\n\n`))
      } catch {
        // already closed/errored
      }
    },
    close: () => {
      try {
        ctrl.close()
      } catch {
        // already closed
      }
    },
  }
}

/**
 * makeMockInterval — captures every `setInterval`/`clearInterval` call so
 * tests can manually fire the watchdog's tick (`tick()`) and assert on how
 * many timers are currently active (`activeCount()`) — the "zero timers
 * after close()/taken-over" DoD.
 */
function makeMockInterval(): {
  _setInterval: typeof setInterval
  _clearInterval: typeof clearInterval
  tick: () => void
  activeCount: () => number
} {
  let nextId = 0
  const active = new Set<number>()
  let latestCallback: (() => void) | undefined
  const _setInterval = ((fn: () => void) => {
    nextId++
    active.add(nextId)
    latestCallback = fn
    return nextId as unknown as ReturnType<typeof setInterval>
  }) as unknown as typeof setInterval
  const _clearInterval = ((id: unknown) => {
    active.delete(id as number)
  }) as unknown as typeof clearInterval
  return {
    _setInterval,
    _clearInterval,
    tick: () => latestCallback?.(),
    activeCount: () => active.size,
  }
}

function makeSnapshot(sessionId = "sess-1"): SessionState {
  return createInitialSessionState({ sessionId })
}

function makePatch(version = 1): Patch {
  return { version, op: "update-session", changes: { status: "connected" } }
}

/** Read exactly n patches from a stream (or fewer if the stream closes). */
async function readNPatches(patches: ReadableStream<Patch>, n: number): Promise<Patch[]> {
  const reader = patches.getReader()
  const results: Patch[] = []
  try {
    for (let i = 0; i < n; i++) {
      const { value, done } = await reader.read()
      if (done) break
      if (value !== undefined) results.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return results
}

const noSleep = (): Promise<void> => Promise.resolve()

// ── slice sse-liveness Commit 4a: abortable SSE body fixture ───────────────────
// Fixture-level tests (not through SSEReader) — proves makeAbortableSSEBody
// actually unblocks a pending read on abort, the exact gap that made Commit
// 4's DoD ("a silent stream ⇒ abort ⇒ #connectOnce is called again")
// unwritable: makeSSEBody/makeSSEResponse ignore init.signal entirely.

describe("test fixture — makeAbortableSSEBody (Commit 4a)", () => {
  it("aborting the signal rejects a pending read on a keepOpen body", async () => {
    const ac = new AbortController()
    const body = makeAbortableSSEBody(
      [{ event: "snapshot", data: "{}" }],
      { keepOpen: true },
      ac.signal,
    )
    const reader = body.getReader()
    await reader.read() // drains the one enqueued chunk — the next read() is pending

    const pending = reader.read()
    ac.abort()

    await expect(pending).rejects.toThrow("aborted")
  })

  it("control case: keepOpen without a signal never resolves on its own — shows why the fix matters", async () => {
    const body = makeAbortableSSEBody([{ event: "snapshot", data: "{}" }], { keepOpen: true })
    const reader = body.getReader()
    await reader.read()

    const outcome = await Promise.race([
      reader.read().then(() => "resolved" as const),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 50)),
    ])
    expect(outcome).toBe("timeout")
  })

  it("wired end-to-end through SSEReader (makeAbortableSSEResponse + real _fetch signal): close() on an otherwise-silent, still-open stream does not hang the background loop", async () => {
    const snapshot = makeSnapshot()
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return Promise.resolve(
        makeAbortableSSEResponse(
          [{ event: "snapshot", data: JSON.stringify(snapshot) }],
          { keepOpen: true }, // stays open — nothing but abort would ever end #drainFrames
          init?.signal,
        ),
      )
    })

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    await reader.connect()

    // Without the fixture honoring `signal`, this would hang the background
    // #drainFrames forever (a `keepOpen` body with no abort-awareness never
    // ends on its own) — the test itself would then time out.
    reader.close()
    await new Promise((r) => setTimeout(r, 20))
    // Reaching this line at all (not timing out) is the proof — close()'s
    // abort actually unblocked the pending read.
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe("test fixture — makeControlledClock (Commit 4a)", () => {
  it("now() returns the last value set by advance() — reading it never itself advances time", () => {
    const clock = makeControlledClock()
    expect(clock.now()).toBe(0)
    expect(clock.now()).toBe(0) // a second read — unlike the old advancingNow — does NOT move time
    clock.advance(5_000)
    expect(clock.now()).toBe(5_000)
    clock.advance(2_000)
    expect(clock.now()).toBe(7_000)
  })

  it("starts from a custom base when given one", () => {
    const clock = makeControlledClock(1_000)
    expect(clock.now()).toBe(1_000)
  })
})

// ── snapshot ──────────────────────────────────────────────────────────────────

describe("SSEReader — connect() snapshot", () => {
  it("returns snapshot from event: snapshot frame", async () => {
    const snapshot = makeSnapshot("sess-42")
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]))

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    const { snapshot: result } = await reader.connect()

    expect(result.sessionId).toBe("sess-42")
    expect(result.version).toBe(snapshot.version)
  })

  it("passes URL and headers to fetch", async () => {
    const snapshot = makeSnapshot()
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]))

    const reader = newReader("/api/agents/a1/events", {
      headers: { Authorization: "Bearer tok" },
      _fetch: mockFetch,
      _sleep: noSleep,
    })
    await reader.connect()

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents/a1/events",
      expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
    )
  })

  it("M7 (calev-heavy): close() aborts the in-flight fetch via AbortSignal", async () => {
    const snapshot = makeSnapshot()
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]))

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    await reader.connect()

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const signal = init.signal as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)

    reader.close()

    expect(signal.aborted).toBe(true)
  })

  it("throws when fetch returns non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response)
    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })

    await expect(reader.connect()).rejects.toThrow("404")
  })

  it("throws when response has no body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: null } as Response)
    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })

    await expect(reader.connect()).rejects.toThrow()
  })
})

// ── patches stream ────────────────────────────────────────────────────────────

describe("SSEReader — patches stream", () => {
  it("emits patches from event: patch frames", async () => {
    const snapshot = makeSnapshot()
    const p1 = makePatch(1)
    const p2 = makePatch(2)

    const mockFetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "patch", data: JSON.stringify(p1) },
        { event: "patch", data: JSON.stringify(p2) },
      ]),
    )

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    const { patches } = await reader.connect()

    const results = await readNPatches(patches, 2)
    expect(results[0]).toMatchObject({ version: 1, op: "update-session" })
    expect(results[1]).toMatchObject({ version: 2, op: "update-session" })
  })

  it("ignores non-patch, non-snapshot events", async () => {
    const snapshot = makeSnapshot()
    const patch = makePatch(3)

    const mockFetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "heartbeat", data: "{}" },
        { event: "patch", data: JSON.stringify(patch) },
      ]),
    )

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    const { patches } = await reader.connect()

    const results = await readNPatches(patches, 1)
    expect(results[0]).toMatchObject({ version: 3 })
  })

  it("B3 (calev-heavy): a malformed JSON frame is skipped, not fatal — later patches still arrive", async () => {
    const snapshot = makeSnapshot()
    const goodPatch = makePatch(9)

    const mockFetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "patch", data: "{not valid json" },
        { event: "patch", data: JSON.stringify(goodPatch) },
      ]),
    )

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    const { patches } = await reader.connect()

    // Only the well-formed patch is ever enqueued — the malformed one is skipped,
    // not confused with "consumer closed the controller" (which would have set
    // #closed=true and silently dropped this good patch too, forever).
    const results = await readNPatches(patches, 1)
    expect(results[0]).toMatchObject({ version: 9 })
  })

  it("round 3 (calev-heavy, root-cause fix): a well-formed-JSON but invalid Patch (unknown op) is rejected by PatchSchema, never enqueued", async () => {
    const snapshot = makeSnapshot()
    // valid JSON, but `op` is not one of the five known Patch variants — the
    // exact scenario calev measured (BE/FE version skew).
    const unknownOpPatch = { version: 1, op: "update-quota", quota: { used: 1 } }
    const goodPatch = makePatch(2)

    const mockFetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "patch", data: JSON.stringify(unknownOpPatch) },
        { event: "patch", data: JSON.stringify(goodPatch) },
      ]),
    )

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    const { patches } = await reader.connect()

    // The invalid patch is rejected at the wire boundary and never reaches the
    // consumer — only the well-formed patch arrives.
    const results = await readNPatches(patches, 1)
    expect(results[0]).toMatchObject({ version: 2 })
  })
})

// ── reconnect ─────────────────────────────────────────────────────────────────

describe("SSEReader — reconnect", () => {
  it("calls onReconnected with new snapshot after stream ends, resumes patches", async () => {
    const snapshot1 = makeSnapshot("sess-1")
    const snapshot2 = makeSnapshot("sess-2")
    const patch = makePatch(5)

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot1) }]),
      )
      .mockResolvedValueOnce(
        makeSSEResponse([
          { event: "snapshot", data: JSON.stringify(snapshot2) },
          { event: "patch", data: JSON.stringify(patch) },
        ]),
      )

    const reconnectedSnapshots: SessionState[] = []
    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    reader.onReconnected = (s) => reconnectedSnapshots.push(s)

    const { patches } = await reader.connect()
    const results = await readNPatches(patches, 1)

    expect(reconnectedSnapshots).toHaveLength(1)
    expect(reconnectedSnapshots[0]?.sessionId).toBe("sess-2")
    expect(results[0]).toMatchObject({ version: 5 })
  })

  it("retries with exponential backoff: 1s → 2s → 4s → 8s on failures", async () => {
    const sleepDelays: number[] = []
    const mockSleep = (ms: number): Promise<void> => {
      sleepDelays.push(ms)
      return Promise.resolve()
    }

    const snapshot = makeSnapshot()
    const patch = makePatch(99)

    let call = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        // Initial connection — snapshot only (stream ends)
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      if (call <= 4) {
        // Reconnect attempts 1–3: fail
        return Promise.reject(new Error("network error"))
      }
      // Reconnect attempt 4: success with patch
      return Promise.resolve(
        makeSSEResponse([
          { event: "snapshot", data: JSON.stringify(snapshot) },
          { event: "patch", data: JSON.stringify(patch) },
        ]),
      )
    })

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: mockSleep })
    const { patches } = await reader.connect()

    const results = await readNPatches(patches, 1)
    expect(results[0]).toMatchObject({ version: 99 })
    // Delays: initial stream ends → 1s, fail→2s, fail→4s, fail→8s, success
    expect(sleepDelays).toEqual([1000, 2000, 4000, 8000])
  })

  it("caps backoff at 30s", async () => {
    const sleepDelays: number[] = []
    const mockSleep = (ms: number): Promise<void> => {
      sleepDelays.push(ms)
      return Promise.resolve()
    }

    const snapshot = makeSnapshot()
    const patch = makePatch(1)

    let call = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      if (call <= 7) {
        return Promise.reject(new Error("network error"))
      }
      return Promise.resolve(
        makeSSEResponse([
          { event: "snapshot", data: JSON.stringify(snapshot) },
          { event: "patch", data: JSON.stringify(patch) },
        ]),
      )
    })

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: mockSleep })
    const { patches } = await reader.connect()

    await readNPatches(patches, 1)
    // After 6 failures: 1s, 2s, 4s, 8s, 16s, 30s(capped), 30s(capped)
    expect(sleepDelays[4]).toBe(16000)
    expect(sleepDelays[5]).toBe(30000)
    expect(sleepDelays[6]).toBe(30000)
  })

  it("resets delay to 1s after successful reconnect", async () => {
    const sleepDelays: number[] = []
    const mockSleep = (ms: number): Promise<void> => {
      sleepDelays.push(ms)
      return Promise.resolve()
    }

    const snapshot = makeSnapshot()
    const patch2 = makePatch(2)

    let call = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        // Initial: snapshot only
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      if (call === 2) {
        // First reconnect: fail
        return Promise.reject(new Error("network error"))
      }
      if (call === 3) {
        // Second reconnect: success but stream ends immediately
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      // Third reconnect: success with patch
      return Promise.resolve(
        makeSSEResponse([
          { event: "snapshot", data: JSON.stringify(snapshot) },
          { event: "patch", data: JSON.stringify(patch2) },
        ]),
      )
    })

    // שעון שמתקדם 15 שניות בכל קריאה ⇒ כל חיבור "שרד" מעל הסף.
    //
    // 🟡 slice sse-liveness Commit 4a — left as a per-call counter on purpose
    // (NOT replaced with `makeControlledClock`, added above for Commit 4's own
    // tests). r7's own re-check found the risk overstated ("זו היגיינה, לא
    // חסם" — no existing assertion here can flip from extra #now() calls,
    // since the predicate is `lastedMs >= STABLE_CONNECTION_MS` and more calls
    // only INCREASE lastedMs). What blocks a safe rewrite: `openedAt`/`lastedMs`
    // are read back-to-back with no externally-observable hook between them (no
    // `_sleep` call happens inside a no-patches `#drainFrames`) — an
    // externally-advanced clock can't be made to move between those two exact
    // reads without one, so a literal rewrite would make `lastedMs` collapse to
    // 0 and silently invert this test's outcome for call 3 (the exact
    // 2026-08-16 flapping-connection regression this test locks). Not worth
    // that risk for a change r7 itself downgraded to non-blocking.
    const advancingNow = (() => {
      let t = 0
      return () => {
        t += 15_000
        return t
      }
    })()

    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: mockSleep,
      _now: advancingNow,
    })
    const { patches } = await reader.connect()

    await readNPatches(patches, 1)
    // initial end → 1s sleep, delay→2s, fail →
    // 2s sleep, delay→4s, success (call 3, שרד 15ש׳) → delay reset to 1s →
    // 1s sleep, delay→2s, success (call 4) → patch emitted
    expect(sleepDelays[0]).toBe(1000)
    expect(sleepDelays[1]).toBe(2000)
    expect(sleepDelays[2]).toBe(1000) // reset — אבל רק כי החיבור החזיק
  })

  it("🔴 חיבור מרצד (נפתח ונסגר מיד) ממשיך להסלים ולא מאפס", async () => {
    // נצפה חי 2026-08-16 (ניתוק-קשה): `sse-reconnected version=111` פעמיים
    // ברצף, `nextInMs=2000` ביניהם — שרת שקיבל וסגר מיד יצר לולאה של ניסיון
    // כל 2ש׳ בלי הסלמה. שעון קפוא ⇒ כל חיבור "חי" 0ms ⇒ אסור שיאפס.
    const sleepDelays: number[] = []
    const mockSleep = (ms: number): Promise<void> => {
      sleepDelays.push(ms)
      return Promise.resolve()
    }

    const snapshot = makeSnapshot()
    const patch = makePatch(7)

    let call = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      call++
      // כל חיבור מצליח — ומת מיד אחרי ה-snapshot. חמש פעמים.
      if (call <= 5) {
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      return Promise.resolve(
        makeSSEResponse([
          { event: "snapshot", data: JSON.stringify(snapshot) },
          { event: "patch", data: JSON.stringify(patch) },
        ]),
      )
    })

    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: mockSleep,
      _now: () => 0, // שעון קפוא — אף חיבור לא שורד את הסף
    })
    const { patches } = await reader.connect()

    await readNPatches(patches, 1)
    // 🔴 לפני התיקון זה היה [1000, 1000, 1000, 1000, 1000] — לולאה צמודה לנצח.
    expect(sleepDelays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000])
  })
})

// ── slice sse-liveness Commit 3ג: 404 is a final state mid-reconnect ───────────

/**
 * The reconnect loop's background `#runLoop` is fire-and-forget (`void
 * this.#runLoop(...)` — connect() doesn't await it). With a mocked `_sleep`
 * that resolves instantly, the loop's own microtask chain still needs a real
 * tick to fully settle before assertions run.
 */
function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 20))
}

describe("SSEReader — 404 mid-reconnect is final, 500/503 are not (Commit 3ג)", () => {
  it("stops retrying after a 404 during the reconnect loop — no further fetch attempts", async () => {
    const snapshot = makeSnapshot()

    let call = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        // Initial connection succeeds, stream ends immediately (no patches) —
        // falls into the reconnect loop.
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      // Every reconnect attempt is met with 404 — the agent is gone.
      return Promise.resolve({ ok: false, status: 404 } as Response)
    })

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    await reader.connect()
    await flushAsync()

    // Exactly ONE reconnect attempt (call 2) — the 404 on it stops the loop
    // permanently. Without the fix, this would keep growing (every 30s in
    // production, or on every instant `noSleep()` tick here — a tight loop).
    expect(call).toBe(2)

    // A second flush proves the loop really stopped, not just paused.
    await flushAsync()
    expect(call).toBe(2)
  })

  it("keeps retrying through 503 (evict-timeout — transient) and 500 (generic) — reaches a patch on eventual success", async () => {
    const snapshot = makeSnapshot()
    const patch = makePatch(1)

    let call = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      if (call === 2) return Promise.resolve({ ok: false, status: 503 } as Response)
      if (call === 3) return Promise.resolve({ ok: false, status: 500 } as Response)
      return Promise.resolve(
        makeSSEResponse([
          { event: "snapshot", data: JSON.stringify(snapshot) },
          { event: "patch", data: JSON.stringify(patch) },
        ]),
      )
    })

    const reader = newReader("/api/events", { _fetch: mockFetch, _sleep: noSleep })
    const { patches } = await reader.connect()

    const results = await readNPatches(patches, 1)
    expect(results[0]).toMatchObject({ version: 1 })
    // initial + 503 + 500 + success — proves it kept retrying through BOTH
    // transient statuses instead of stopping like it does on 404.
    expect(call).toBe(4)
  })
})

// ── slice ownership-handoff C3: taken-over event handling ──────────────────

describe("SSEReader — taken-over event (ownership-handoff C3)", () => {
  it("stops reconnecting after receiving taken-over event", async () => {
    const snapshot = makeSnapshot()
    let callCount = 0

    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve(
        makeSSEResponse([
          { event: "snapshot", data: JSON.stringify(snapshot) },
          { event: "taken-over", data: "{}" },
        ]),
      )
    })

    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    })
    const { patches } = await reader.connect()

    // Drain until the stream closes (taken-over stops the loop)
    const r = patches.getReader()
    let done = false
    while (!done) {
      const result = await r.read()
      done = result.done
    }
    r.releaseLock()

    // Only 1 fetch call — no reconnect after taken-over
    expect(callCount).toBe(1)
  })

  it("calls onTakenOver callback when taken-over event received", async () => {
    const snapshot = makeSnapshot()
    const onTakenOver = vi.fn()

    const mockFetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "taken-over", data: "{}" },
      ]),
    )

    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: () => Promise.resolve(),
    })
    reader.onTakenOver = onTakenOver
    const { patches } = await reader.connect()

    const r = patches.getReader()
    let done = false
    while (!done) {
      const result = await r.read()
      done = result.done
    }
    r.releaseLock()

    expect(onTakenOver).toHaveBeenCalledTimes(1)
  })
})

// ── slice sse-liveness Commit 4: the silence-watchdog ───────────────────────

describe("SSEReader — silence-watchdog (Commit 4)", () => {
  it("a stream with ONLY heartbeats (stream-alive frames) stays alive past the threshold — the watchdog never fires", async () => {
    const snapshot = makeSnapshot()
    const controllable = makeControllableSSEBody()
    const mockFetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        body: controllable.body,
      } as unknown as Response)
    })

    const clock = makeControlledClock()
    const interval = makeMockInterval()
    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: noSleep,
      _now: clock.now,
      _setInterval: interval._setInterval,
      _clearInterval: interval._clearInterval,
    })

    controllable.push({ event: "snapshot", data: JSON.stringify(snapshot) })
    await reader.connect()

    // 3 heartbeats, each arriving just under the threshold — each one must
    // reset the watchdog so the NEXT tick (at the full threshold) never fires.
    for (let i = 0; i < 3; i++) {
      clock.advance(SSE_WATCHDOG_THRESHOLD_MS - 1)
      controllable.push({
        event: "stream-alive",
        data: JSON.stringify({ jsonrpc: "2.0", method: "_drive/streamAlive", params: {} }),
      })
      await new Promise((r) => setTimeout(r, 0)) // let #drainFrames actually process the pushed frame
      interval.tick()
    }

    expect(mockFetch).toHaveBeenCalledTimes(1) // never reconnected — the watchdog never aborted
  })

  it("🔴 a completely silent stream ⇒ watchdog aborts ⇒ #connectOnce is called again — this is the proof the reconnect thread is pulled", async () => {
    const snapshot = makeSnapshot()
    let call = 0
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      call++
      return Promise.resolve(
        makeAbortableSSEResponse(
          [{ event: "snapshot", data: JSON.stringify(snapshot) }],
          { keepOpen: true }, // stays open, sends nothing more — total silence
          init?.signal,
        ),
      )
    })

    const clock = makeControlledClock()
    const interval = makeMockInterval()
    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: noSleep,
      _now: clock.now,
      _setInterval: interval._setInterval,
      _clearInterval: interval._clearInterval,
    })

    await reader.connect()
    expect(call).toBe(1)

    clock.advance(SSE_WATCHDOG_THRESHOLD_MS) // silence for exactly the threshold
    interval.tick() // manually fire the watchdog's periodic check

    // Let the abort's rejection propagate through #drainFrames's catch-all and
    // into #runLoop's reconnect branch (real macrotask/microtask settle).
    await new Promise((r) => setTimeout(r, 20))

    expect(call).toBe(2) // #connectOnce was called again
  })

  it("backoff פעיל (בין ניסיונות, בלי חיבור פתוח) ⇒ הגלאי אינו רץ — אפס טיימרים פעילים", async () => {
    const snapshot = makeSnapshot()
    let call = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        // Initial: snapshot only, stream ends immediately — falls into backoff.
        return Promise.resolve(
          makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]),
        )
      }
      // Never resolves again in this test — proves nothing but the reconnect
      // loop's own sleep/retry drives further attempts (no stray watchdog).
      return new Promise<Response>(() => {})
    })

    const interval = makeMockInterval()
    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: noSleep,
      _setInterval: interval._setInterval,
      _clearInterval: interval._clearInterval,
    })

    await reader.connect()
    // Let #drainFrames end (initial connection had no patches) and
    // #stopWatchdog run, before the loop settles into its backoff sleep.
    await new Promise((r) => setTimeout(r, 20))

    expect(interval.activeCount()).toBe(0)
  })

  it("close() leaves zero active watchdog timers", async () => {
    const snapshot = makeSnapshot()
    const mockFetch = vi.fn().mockResolvedValue(
      makeAbortableSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }], {
        keepOpen: true,
      }),
    )
    const interval = makeMockInterval()
    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: noSleep,
      _setInterval: interval._setInterval,
      _clearInterval: interval._clearInterval,
    })
    await reader.connect()
    expect(interval.activeCount()).toBe(1) // watchdog running while the connection is open

    reader.close()
    expect(interval.activeCount()).toBe(0)
  })

  it("taken-over leaves zero active watchdog timers", async () => {
    const snapshot = makeSnapshot()
    const mockFetch = vi.fn().mockResolvedValue(
      makeSSEResponse([
        { event: "snapshot", data: JSON.stringify(snapshot) },
        { event: "taken-over", data: "{}" },
      ]),
    )
    const interval = makeMockInterval()
    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: noSleep,
      _setInterval: interval._setInterval,
      _clearInterval: interval._clearInterval,
    })
    const { patches } = await reader.connect()

    const r = patches.getReader()
    let done = false
    while (!done) {
      const result = await r.read()
      done = result.done
    }
    r.releaseLock()

    expect(interval.activeCount()).toBe(0)
  })
})

// ── slice sse-liveness Commit 4: snapshot-wait timeout (מקרה-קצה) ──────────

describe("SSEReader — snapshot-wait timeout (Commit 4)", () => {
  it("a connection that opens but never sends snapshot times out within the bound instead of hanging forever — connect() rejects, not a silent death", async () => {
    // A tiny REAL timeout via `_snapshotTimeoutMs` (not vi.useFakeTimers() +
    // advanceTimersByTimeAsync racing a Promise.race across several `await`
    // hops — that combination produced spurious `PromiseRejectionHandled
    // Warning` noise in this exact codebase/runtime, harmless per Node's own
    // docs but still noise the DoD gate shouldn't have to tolerate).
    const mockFetch = vi.fn().mockResolvedValue(makeAbortableSSEResponse([], { keepOpen: true }))
    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: noSleep,
      _snapshotTimeoutMs: 5,
    })

    await expect(reader.connect()).rejects.toThrow("timed out waiting for snapshot")
  })

  it("does not fire when the snapshot arrives comfortably within the (tiny, test-only) bound", async () => {
    const snapshot = makeSnapshot()
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeSSEResponse([{ event: "snapshot", data: JSON.stringify(snapshot) }]))
    const reader = newReader("/api/events", {
      _fetch: mockFetch,
      _sleep: noSleep,
      _snapshotTimeoutMs: 5,
    })

    const { snapshot: result } = await reader.connect()
    expect(result.sessionId).toBe(snapshot.sessionId)
  })
})
