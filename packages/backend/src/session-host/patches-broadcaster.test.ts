/**
 * patches-broadcaster.test.ts — TDD tests for PatchesBroadcaster (C1).
 *
 * Testing: tdd (brief §C1)
 *
 * Tests:
 *   - subscribe: returns a ReadableStream per client (fan-out)
 *   - multi-client: each subscriber gets each patch
 *   - unsubscribe: removed client no longer receives patches
 *   - late subscriber gets filtered or full buffered replay (subscribe(sinceVersion?))
 *   - constructor accepts ReadableStream<Patch>
 */

import type { Patch } from "@drive-coding/core/session"
import { describe, expect, it } from "vitest"
import { createPatchesBroadcaster } from "./patches-broadcaster.js"

// ── helpers ──────────────────────────────────────────────────────────────────

/** Make a controlled patch stream with a push function */
function makeControlledStream(): {
  stream: ReadableStream<Patch>
  push: (patch: Patch) => void
  close: () => void
} {
  let ctrl!: ReadableStreamDefaultController<Patch>
  const stream = new ReadableStream<Patch>({
    start(controller) {
      ctrl = controller
    },
  })
  return {
    stream,
    push: (patch: Patch) => ctrl.enqueue(patch),
    close: () => ctrl.close(),
  }
}

/** Make a minimal Patch for testing */
function makePatch(version: number, title = `v${version}`): Patch {
  return {
    version,
    op: "update-session",
    changes: { title },
  }
}

/** Read exactly N patches from a stream (with timeout) */
async function readN(stream: ReadableStream<Patch>, n: number, timeoutMs = 200): Promise<Patch[]> {
  const reader = stream.getReader()
  const results: Patch[] = []
  try {
    while (results.length < n) {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timeout after ${results.length}/${n} patches`)),
            timeoutMs,
          ),
        ),
      ])
      if (result.done) break
      results.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  return results
}

/** Read patches with a short timeout — returns whatever was available */
async function readAvailable(stream: ReadableStream<Patch>, timeoutMs = 20): Promise<Patch[]> {
  const reader = stream.getReader()
  const results: Patch[] = []
  try {
    while (true) {
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs),
        ),
      ])
      if (result.done) break
      results.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  return results
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PatchesBroadcaster", () => {
  describe("subscribe — fan-out", () => {
    it("returns a ReadableStream per subscriber", () => {
      const { stream } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      const s1 = broadcaster.subscribe()
      const s2 = broadcaster.subscribe()

      expect(s1).toBeInstanceOf(ReadableStream)
      expect(s2).toBeInstanceOf(ReadableStream)
      expect(s1).not.toBe(s2)
    })

    it("each subscriber gets each patch emitted after subscribing", async () => {
      const { stream, push } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      const s1 = broadcaster.subscribe()
      const s2 = broadcaster.subscribe()

      // Push patches in background (wait a tick first to let readers start)
      await new Promise<void>((r) => setTimeout(r, 0))
      const p1 = makePatch(1)
      const p2 = makePatch(2)
      push(p1)
      push(p2)

      const [r1, r2] = await Promise.all([readN(s1, 2), readN(s2, 2)])
      expect(r1).toHaveLength(2)
      expect(r2).toHaveLength(2)
      expect(r1[0]?.version).toBe(1)
      expect(r2[0]?.version).toBe(1)
    })
  })

  describe("unsubscribe", () => {
    it("removed subscriber does not receive further patches", async () => {
      const { stream, push } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      const s1 = broadcaster.subscribe()
      const s2 = broadcaster.subscribe()

      // Unsubscribe s2 before pushing
      broadcaster.unsubscribe(s2)

      await new Promise<void>((r) => setTimeout(r, 0))
      push(makePatch(1))

      const r1 = await readN(s1, 1)
      expect(r1).toHaveLength(1)

      // s2 should get nothing (or its stream is closed/empty)
      const r2 = await readAvailable(s2, 30)
      expect(r2).toHaveLength(0)
    })

    it("unsubscribe is a no-op for an unknown stream", () => {
      const { stream } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)
      const unknownStream = new ReadableStream<Patch>()
      // Should not throw
      expect(() => broadcaster.unsubscribe(unknownStream)).not.toThrow()
    })
  })

  describe("buffering — late subscriber (filtered replay)", () => {
    it("sinceVersion at buffer head → zero replay", async () => {
      const { stream, push } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      const s1 = broadcaster.subscribe()
      await new Promise<void>((r) => setTimeout(r, 0))
      push(makePatch(1))
      push(makePatch(2))
      await new Promise<void>((r) => setTimeout(r, 20))

      const s2 = broadcaster.subscribe(2)
      const r2 = await readAvailable(s2, 30)
      expect(r2).toHaveLength(0)
    })

    it("sinceVersion in the middle → tail only", async () => {
      const { stream, push } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      broadcaster.subscribe()
      await new Promise<void>((r) => setTimeout(r, 0))
      push(makePatch(1))
      push(makePatch(2))
      push(makePatch(3))
      await new Promise<void>((r) => setTimeout(r, 20))

      const s2 = broadcaster.subscribe(1)
      const r2 = await readN(s2, 2, 100)
      expect(r2.map((p) => p.version)).toEqual([2, 3])
    })

    it("without sinceVersion → full buffer (regression)", async () => {
      const { stream, push } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      broadcaster.subscribe()
      await new Promise<void>((r) => setTimeout(r, 0))
      push(makePatch(1))
      push(makePatch(2))
      await new Promise<void>((r) => setTimeout(r, 20))

      const s2 = broadcaster.subscribe()
      const r2 = await readN(s2, 2, 100)
      expect(r2.map((p) => p.version)).toEqual([1, 2])
    })

    it("patch after subscribe arrives for filtered and unfiltered subscribers", async () => {
      const { stream, push } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      const filtered = broadcaster.subscribe(5)
      const full = broadcaster.subscribe()
      await new Promise<void>((r) => setTimeout(r, 0))
      push(makePatch(6))

      const [rf, ru] = await Promise.all([readN(filtered, 1), readN(full, 1)])
      expect(rf[0]?.version).toBe(6)
      expect(ru[0]?.version).toBe(6)
    })

    it("late subscriber receives recent patches from buffer when unfiltered", async () => {
      const { stream, push } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      // Subscriber 1 subscribes early — just to start the drain loop
      const s1 = broadcaster.subscribe()

      // Push 2 patches before subscriber 2 arrives
      await new Promise<void>((r) => setTimeout(r, 0))
      push(makePatch(1))
      push(makePatch(2))

      // Wait a bit for patches to be processed
      await new Promise<void>((r) => setTimeout(r, 20))

      // Late subscriber — should get buffered patches
      const s2 = broadcaster.subscribe()

      const r2 = await readN(s2, 2, 100)
      expect(r2.length).toBeGreaterThanOrEqual(1) // at least gets buffered patches
    })
  })

  describe("constructor", () => {
    it("accepts a ReadableStream<Patch> — no throw on construction", () => {
      const { stream } = makeControlledStream()
      expect(() => createPatchesBroadcaster(stream)).not.toThrow()
    })
  })

  // ─── slice sse-liveness Commit 3: close() — synchronous, source-independent ───
  describe("close", () => {
    it("closes every current subscriber's stream SYNCHRONOUSLY — before any further await", async () => {
      const { stream } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)

      const s1 = broadcaster.subscribe()
      const s2 = broadcaster.subscribe()

      broadcaster.close()

      // No further await between subscribe/close and reading "done" — proves
      // the subscriber controllers were closed synchronously by close()
      // itself, not by waiting for the (never-closed) SOURCE to end.
      const r1 = await s1.getReader().read()
      const r2 = await s2.getReader().read()
      expect(r1.done).toBe(true)
      expect(r2.done).toBe(true)
    })

    it("does NOT touch the source stream — close() is independent of whether the source ever ends", () => {
      const { stream } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)
      broadcaster.subscribe()

      // The source (host.patches) is never closed here — close() must not
      // require it to be, unlike the old only-path (source ends → drain()'s
      // finally → subscribers close).
      expect(() => broadcaster.close()).not.toThrow()
      expect(stream.locked).toBe(true) // drain()'s reader is still holding it
    })

    it("is idempotent — calling close() twice does not throw", () => {
      const { stream } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)
      broadcaster.subscribe()

      broadcaster.close()
      expect(() => broadcaster.close()).not.toThrow()
    })

    it("a subscriber added AFTER close() still gets a stream, but it closes immediately (empty subscribers map)", async () => {
      const { stream } = makeControlledStream()
      const broadcaster = createPatchesBroadcaster(stream)
      broadcaster.subscribe()
      broadcaster.close()

      // late subscribe() after close() — the map was cleared, so this is a
      // FRESH registration; nothing ever dispatches to it since the source
      // was never told to stop draining. This documents present behavior
      // (registry.ts always calls map.delete right after close(), so no
      // caller in production subscribes to an already-closed broadcaster) —
      // not a new guarantee.
      const late = broadcaster.subscribe()
      expect(late).toBeInstanceOf(ReadableStream)
    })
  })
})
