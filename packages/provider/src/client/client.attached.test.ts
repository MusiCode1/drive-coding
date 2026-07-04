/**
 * client.attached.test.ts — TDD: createAttachedAcpClient (warm reattach, skip initialize).
 *
 * Slice warm-reattach-skip-init, Commit 0.
 *
 * Tests:
 *   1. createAttachedAcpClient — no "initialize" frame written (core invariant)
 *   2. loadSession call writes a "session/load" frame
 *   3. capabilities from options are returned on client.capabilities
 *   4. default capabilities (no options) does not throw
 *   5. regression: createAcpClient still writes "initialize" frame
 */

import { describe, expect, it } from "vitest"
import type { AcpTransport } from "../transport/types.js"
import { createAcpClient, createAttachedAcpClient } from "./client.js"

// ─── transport double ─────────────────────────────────────────────────────────

/**
 * In-memory AcpTransport double.
 * - writable: captures every chunk written by the SDK into `written`
 * - readable: allows injecting lines via pushIn (decoded to Uint8Array + \n)
 * - close / onClose: no-ops (the facade calls transport.close(); without this
 *   we get a TypeError that would mask the real assertion failure)
 */
function makeTransportDouble() {
  const written: string[] = []
  const dec = new TextDecoder()
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(dec.decode(chunk))
    },
  })

  let pushIn!: (line: string) => void
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      pushIn = (line) => c.enqueue(enc.encode(line.endsWith("\n") ? line : `${line}\n`))
    },
  })

  // AcpTransport requires exactly 4 members (transport/types.ts:25-30):
  //   readable, writable, close(): void, onClose(cb): void
  // Without close/onClose the facade throws at runtime and hides the real failure.
  const transport: AcpTransport = {
    readable,
    writable,
    close() {},
    onClose(_cb) {},
  }

  return { transport, written, pushIn }
}

// ─── helper: stringify written frames for assertions ─────────────────────────

function joinWritten(written: string[]) {
  return written.join("")
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("createAttachedAcpClient", () => {
  it("does NOT write any 'initialize' frame", () => {
    const { transport, written } = makeTransportDouble()

    createAttachedAcpClient(transport, () => {})

    // Give the microtask queue a chance to flush any synchronous SDK writes.
    // The SDK may write frames synchronously on construction, so we check immediately.
    expect(joinWritten(written)).not.toContain("initialize")
  })

  it("loadSession call writes a frame containing 'session/load'", async () => {
    const { transport, written } = makeTransportDouble()

    const client = createAttachedAcpClient(transport, () => {})

    // Fire loadSession — don't await (no server to respond); just verify the frame
    // is enqueued on the wire. The Promise will remain pending.
    void client.loadSession({ sessionId: "test-session", cwd: "/tmp" })

    // Allow microtask queue to flush the write.
    await Promise.resolve()

    expect(joinWritten(written)).toContain("session/load")
  })

  it("returns capabilities passed via options", () => {
    const { transport } = makeTransportDouble()

    // AcpClient["capabilities"] is the raw agentCapabilities shape from initialize.
    // We pass a cast empty object — mirrors what the real warm path does (§4 brief).
    const fakeCaps = { someFlag: true } as unknown as Parameters<
      typeof createAttachedAcpClient
    >[2] extends { capabilities?: infer C }
      ? C
      : never

    const client = createAttachedAcpClient(transport, () => {}, { capabilities: fakeCaps })

    expect(client.capabilities).toBe(fakeCaps)
  })

  it("works without options (default empty capabilities, no throw)", () => {
    const { transport } = makeTransportDouble()

    expect(() => createAttachedAcpClient(transport, () => {})).not.toThrow()
  })
})

describe("createAcpClient regression — still writes initialize", () => {
  it("writes an 'initialize' frame before timeout", async () => {
    // We only need to verify that createAcpClient attempts to write "initialize".
    // The full round-trip (await clientPromise) is difficult without a real ACP server
    // because the SDK's ReadableStream consumer runs asynchronously and requires
    // queueMicrotask/setTimeout scheduling that is hard to drive from the outside.
    // The core invariant we need: the cold path writes "initialize"; createAttachedAcpClient does not.
    // Strategy: use a very short timeout so we can catch the written frames before the race ends.
    const { transport, written } = makeTransportDouble()

    // Don't await — we just want to trigger the frame writes.
    const clientPromise = createAcpClient(transport, () => {}, { initTimeoutMs: 50 })
    // Suppress the expected timeout rejection so the test runner doesn't see an unhandled rejection.
    clientPromise.catch(() => {})

    // Flush microtasks — the SDK writes the initialize frame synchronously when
    // ClientSideConnection.initialize() is called (it serialises the request and
    // pushes it to the writable stream synchronously before awaiting the response).
    await Promise.resolve()

    // Core regression assertion: initialize frame must be present for cold path.
    expect(joinWritten(written)).toContain("initialize")

    // Wait for the timeout to fire so the promise settles (no dangling timers in vitest).
    await new Promise((r) => setTimeout(r, 100))
  })
})
