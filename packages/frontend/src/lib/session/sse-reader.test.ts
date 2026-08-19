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
