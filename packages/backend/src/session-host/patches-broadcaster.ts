/**
 * patches-broadcaster.ts — PatchesBroadcaster (S4 C1).
 *
 * Fan-out/tee over a single ReadableStream<Patch>.
 * Maintains a ring-buffer of the last N patches so late subscribers
 * can receive buffered patches (supports filtered replay via `sinceVersion`).
 *
 * The constructor drains the source stream in the background via a shared
 * drain loop — each new patch is dispatched to all current subscribers.
 *
 * ─── slice session-host-http C1 (TDD) ───
 */

import type { Patch } from "@drive-coding/core/session"

/** Maximum number of patches kept in the buffer for late subscribers. */
const BUFFER_SIZE = 64

export type PatchesBroadcaster = {
  /**
   * subscribe — returns a new ReadableStream<Patch> for this client.
   * @param sinceVersion — when set, replay only patches with version > sinceVersion;
   *   when omitted, replay the full buffer (compatibility / sse-resume tail).
   */
  subscribe(sinceVersion?: number): ReadableStream<Patch>

  /**
   * unsubscribe — removes the client stream from the fan-out.
   * The stream's controller is closed so the reader sees done=true.
   * No-op if the stream is not currently subscribed.
   */
  unsubscribe(stream: ReadableStream<Patch>): void

  /**
   * close — slice sse-liveness Commit 3: terminates every current subscriber
   * stream SYNCHRONOUSLY (same code the background `drain()` loop's `finally`
   * already runs when the SOURCE ends), without waiting for the source to end.
   *
   * Why this exists: `registry.ts`'s `unregisterHost` is called from two
   * sites (`deleteAndKill`, the crash handler) that never call `host.dispose()`
   * first — before this method, NOTHING ever ended the broadcaster for those
   * paths, so GET /events subscribers (and their keepalive timer) leaked
   * forever. A third site (`ws-agent.ts`'s WS-takeover path) DOES call
   * `host.dispose()` first, which cascades to the same effect via the source
   * ending — but only after several extra microtask hops (source read()
   * resolves → this drain() loop resumes → its finally runs). `close()`
   * collapses that to ONE hop, callable independently of whether the host
   * (or its `patches` source) is disposed at all — see `unregisterHost`.
   */
  close(): void
}

/**
 * createPatchesBroadcaster — creates a PatchesBroadcaster from a source stream.
 * Starts draining the source in the background immediately.
 *
 * @param source — host.patches (ReadableStream<Patch>)
 */
export function createPatchesBroadcaster(source: ReadableStream<Patch>): PatchesBroadcaster {
  // Ring buffer of the last N patches
  const buffer: Patch[] = []

  // Map from stream → controller for active subscribers
  const subscribers = new Map<ReadableStream<Patch>, ReadableStreamDefaultController<Patch>>()

  // Dispatch a patch to all subscribers + add to buffer
  function dispatch(patch: Patch): void {
    // Add to ring buffer
    buffer.push(patch)
    if (buffer.length > BUFFER_SIZE) {
      buffer.shift()
    }
    // Fan-out to all subscribers
    for (const [, ctrl] of subscribers) {
      try {
        ctrl.enqueue(patch)
      } catch {
        // Controller may be closed (client disconnected) — ignore silently
      }
    }
  }

  // Close every current subscriber's controller synchronously and clear the
  // map. Shared by drain()'s finally (source ended) and the public close()
  // (slice sse-liveness Commit 3 — caller-triggered, source-independent).
  function closeAllSubscribers(): void {
    for (const [, ctrl] of subscribers) {
      try {
        ctrl.close()
      } catch {
        // Already closed
      }
    }
    subscribers.clear()
  }

  // Drain the source stream in the background
  async function drain(): Promise<void> {
    const reader = source.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        dispatch(value)
      }
    } catch {
      // Source stream errored or was cancelled — stop draining silently
    } finally {
      // Close all subscriber streams when source ends
      closeAllSubscribers()
      reader.releaseLock()
    }
  }

  // Start draining immediately (fire and forget)
  void drain()

  return {
    subscribe(sinceVersion?: number): ReadableStream<Patch> {
      let ctrl!: ReadableStreamDefaultController<Patch>
      const stream = new ReadableStream<Patch>({
        start(controller) {
          ctrl = controller
        },
        cancel() {
          // Client cancelled — remove from map
          subscribers.delete(stream)
        },
      })

      // Register the subscriber BEFORE replaying the buffer
      // (so no patches are missed between buffer replay and live dispatch)
      subscribers.set(stream, ctrl)

      // Replay buffered patches to the new subscriber
      const replay =
        sinceVersion === undefined
          ? buffer
          : buffer.filter((p) => p.version > sinceVersion)
      for (const patch of replay) {
        try {
          ctrl.enqueue(patch)
        } catch {
          // Already closed
        }
      }

      return stream
    },

    unsubscribe(stream: ReadableStream<Patch>): void {
      const ctrl = subscribers.get(stream)
      if (!ctrl) return
      subscribers.delete(stream)
      try {
        ctrl.close()
      } catch {
        // Already closed
      }
    },

    close(): void {
      closeAllSubscribers()
    },
  }
}
