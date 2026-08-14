/**
 * sse-reader.ts — SSEReader: fetch + ReadableStream SSE client with manual reconnect.
 *
 * לא משתמש ב-EventSource (לא תומך ב-POST/headers).
 * מתחבר עם fetch + ReadableStream, מנתח SSE framing ידנית.
 *
 * Protocol:
 *   event: snapshot\nid: <epoch>\ndata: <JSON SessionState>\n\n  ← frame-zero (חייב להיות ראשון)
 *   event: patch\ndata: <JSON Patch>\n\n                        ← עדכונים שוטפים
 *   event: taken-over\nid: <new-epoch>\ndata: {}\n\n            ← terminal: stop reconnecting
 *
 * Reconnect: exponential backoff (1s, 2s, 4s, ..., max 30s).
 * On reconnect: calls onReconnected(newSnapshot) before resuming patches.
 *
 * ─── slice remote-session-view C1 (TDD) ───
 */

import { type Patch, PatchSchema, type SessionState } from "@drive-coding/core/session"
import { type } from "arktype"

// ─── SSE frame parsing ────────────────────────────────────────────────────────

type SSEFrame = { event: string; data: string }

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
        } else if (line === "") {
          // Empty line → dispatch event
          if (currentEvent && currentData) {
            yield { event: currentEvent, data: currentData }
          }
          currentEvent = ""
          currentData = ""
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
}

/** Maximum reconnect delay (ms). */
const MAX_BACKOFF_MS = 30_000

/**
 * SSEReader — reads an SSE endpoint using fetch + ReadableStream.
 *
 * Usage:
 *   const reader = new SSEReader('/api/agents/a1/events', { headers: {...} })
 *   const { snapshot, patches } = await reader.connect()
 *   // patches is ReadableStream<Patch> — individual patches
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
  #closed = false
  // calev-heavy M7: close() didn't abort the in-flight fetch — the underlying
  // socket/request stayed established (leaked) until the server eventually
  // noticed the client was gone (or never did). Aborting on close() releases it
  // immediately, and also unblocks any pending body reader.read() (which is what
  // makes close() actually stop an active connection promptly, not just future ones).
  #abortController: AbortController | null = null

  constructor(url: string, opts: SSEReaderOptions = {}) {
    this.#url = url
    this.#headers = opts.headers ?? {}
    this.#doFetch = opts._fetch ?? ((u, init) => globalThis.fetch(u, init))
    this.#sleep = opts._sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /**
   * Connect to the SSE endpoint.
   * Returns the initial snapshot and a long-lived patches stream.
   * The patches stream survives reconnects (automatic exponential backoff).
   */
  async connect(): Promise<{ snapshot: SessionState; patches: ReadableStream<Patch> }> {
    this.#closed = false

    // Initial connection — must receive snapshot as first frame
    const { snapshot, frames } = await this.#connectOnce()

    // Long-lived patches stream — drained by background loop
    let patchCtrl!: ReadableStreamDefaultController<Patch>
    const patches = new ReadableStream<Patch>({
      start: (ctrl) => {
        patchCtrl = ctrl
      },
      cancel: () => {
        this.#closed = true
      },
    })

    // Background loop: drain initial frames, then reconnect-loop
    void this.#runLoop(frames, patchCtrl)

    return { snapshot, patches }
  }

  /** Stop reconnect attempts, abort any in-flight request, and close the patches stream. */
  close(): void {
    this.#closed = true
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
      throw new Error(`SSEReader: fetch failed with status ${res.status}`)
    }
    if (!res.body) {
      throw new Error("SSEReader: response has no body")
    }

    const frames = readSSEFrames(res.body)

    // Advance past any non-snapshot frames to find the required snapshot frame-zero
    let next = await frames.next()
    while (!next.done && next.value.event !== "snapshot") {
      next = await frames.next()
    }
    if (next.done || next.value.event !== "snapshot") {
      throw new Error("SSEReader: no snapshot frame received")
    }

    const snapshot = JSON.parse(next.value.data) as SessionState
    return { snapshot, frames }
  }

  /**
   * runLoop — drains patches from the initial connection, then reconnects
   * indefinitely with exponential backoff until close() is called.
   */
  async #runLoop(
    frames: AsyncGenerator<SSEFrame>,
    ctrl: ReadableStreamDefaultController<Patch>,
  ): Promise<void> {
    // Drain initial connection patches
    await this.#drainFrames(frames, ctrl)

    if (this.#closed) {
      this.#closeCtrl(ctrl)
      return
    }

    // Reconnect loop
    let delay = 1000

    while (!this.#closed) {
      await this.#sleep(delay)
      if (this.#closed) break

      // Double delay for next attempt (before the attempt so failure doubles)
      delay = Math.min(delay * 2, MAX_BACKOFF_MS)

      try {
        const { snapshot, frames: newFrames } = await this.#connectOnce()
        if (this.#closed) break

        // Reset delay after successful connection
        delay = 1000

        // Notify about the new snapshot
        this.onReconnected?.(snapshot)

        // Drain patches from the reconnected connection
        await this.#drainFrames(newFrames, ctrl)
        // Stream ended cleanly — loop to reconnect again
      } catch {
        // Connection failed — continue with next retry (delay already doubled)
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
    ctrl: ReadableStreamDefaultController<Patch>,
  ): Promise<void> {
    try {
      for await (const frame of frames) {
        if (this.#closed) return
        // slice ownership-handoff C3: taken-over signals a terminal end — stop reconnecting
        if (frame.event === "taken-over") {
          this.#closed = true
          this.onTakenOver?.()
          return
        }
        if (frame.event !== "patch") continue

        let raw: unknown
        try {
          raw = JSON.parse(frame.data)
        } catch {
          // Malformed JSON on the wire — skip it, keep draining subsequent frames.
          continue
        }

        const validated = PatchSchema(raw)
        if (validated instanceof type.errors) {
          // Well-formed JSON, but not a valid Patch (e.g. an `op` this build
          // doesn't know — BE/FE version skew). Skip it — never enqueued, so
          // its version never influences the consumer's dedup tracking.
          console.warn(`SSEReader: invalid patch on wire, skipping — ${validated.summary}`)
          continue
        }

        try {
          ctrl.enqueue(validated as Patch)
        } catch {
          // Controller closed by consumer — stop
          this.#closed = true
          return
        }
      }
    } catch {
      // Stream read error — caller will trigger reconnect
    }
  }

  #closeCtrl(ctrl: ReadableStreamDefaultController<Patch>): void {
    try {
      ctrl.close()
    } catch {
      // Already closed
    }
  }
}
