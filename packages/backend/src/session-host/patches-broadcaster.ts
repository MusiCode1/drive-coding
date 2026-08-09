/**
 * patches-broadcaster.ts — PatchesBroadcaster (S4 C1).
 *
 * Fan-out/tee over a single ReadableStream<Patch>.
 * Maintains a ring-buffer of the last N patches so late subscribers
 * can receive buffered patches (supports the "register-then-snapshot" pattern).
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
   * Late subscribers receive buffered patches first, then live ones.
   */
  subscribe(): ReadableStream<Patch>

  /**
   * unsubscribe — removes the client stream from the fan-out.
   * The stream's controller is closed so the reader sees done=true.
   * No-op if the stream is not currently subscribed.
   */
  unsubscribe(stream: ReadableStream<Patch>): void
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
  const subscribers = new Map<
    ReadableStream<Patch>,
    ReadableStreamDefaultController<Patch>
  >()

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
      for (const [, ctrl] of subscribers) {
        try {
          ctrl.close()
        } catch {
          // Already closed
        }
      }
      subscribers.clear()
      reader.releaseLock()
    }
  }

  // Start draining immediately (fire and forget)
  void drain()

  return {
    subscribe(): ReadableStream<Patch> {
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
      for (const patch of buffer) {
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
  }
}
