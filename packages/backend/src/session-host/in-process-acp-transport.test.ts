/**
 * in-process-acp-transport.test.ts — TDD tests for InProcessAcpTransport (C1).
 *
 * Testing: tdd (brief §C1)
 *
 * Tests:
 *   - readable: lines from onLine arrive as Uint8Array chunks with \n suffix
 *   - writable: Uint8Array written triggers conn.wire.write (re-adds \n — NDJSON child framing)
 *   - writable: line-buffer/split on \n — SDK chunks may be multi-line or partial
 *   - close(): after close, no more writes or callbacks
 *   - onClose: maps to conn.onCrash — BridgeCrashInfo → (code, reason) adapter
 *   - TextEncoder/TextDecoder: string ↔ Uint8Array
 */

import { describe, expect, it, vi } from "vitest"
import type { BridgeCrashInfo } from "@drive-coding/provider/spawn"
import { createInProcessAcpTransport } from "./in-process-acp-transport.js"

// ── helpers ──────────────────────────────────────────────────────────────────

type MockWire = {
  onLine: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  _triggerLine: (line: string) => void
}

type MockOnCrash = {
  onCrash: ReturnType<typeof vi.fn>
  _triggerCrash: (info: BridgeCrashInfo) => void
}

function makeMockConnection(): MockWire & MockOnCrash {
  const lineListeners: Array<(line: string) => void> = []
  const crashListeners: Array<(info: BridgeCrashInfo) => void> = []

  return {
    onLine: vi.fn((cb: (line: string) => void) => {
      lineListeners.push(cb)
      return () => {
        const i = lineListeners.indexOf(cb)
        if (i >= 0) lineListeners.splice(i, 1)
      }
    }),
    write: vi.fn(() => true),
    onCrash: vi.fn((cb: (info: BridgeCrashInfo) => void) => {
      crashListeners.push(cb)
      return () => {
        const i = crashListeners.indexOf(cb)
        if (i >= 0) crashListeners.splice(i, 1)
      }
    }),
    _triggerLine(line: string) {
      lineListeners.forEach((cb) => cb(line))
    },
    _triggerCrash(info: BridgeCrashInfo) {
      crashListeners.forEach((cb) => cb(info))
    },
  }
}

/** Read n chunks from a ReadableStream<Uint8Array> */
async function readChunks(
  stream: ReadableStream<Uint8Array>,
  n: number,
): Promise<Uint8Array[]> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (chunks.length < n) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  reader.releaseLock()
  return chunks
}

/** Decode Uint8Array to string */
const dec = new TextDecoder()
const enc = new TextEncoder()

// ── tests ─────────────────────────────────────────────────────────────────────

describe("InProcessAcpTransport", () => {
  describe("readable — onLine → Uint8Array with \\n suffix", () => {
    it("emits a Uint8Array chunk for each onLine event, with \\n appended", async () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const chunksPromise = readChunks(transport.readable, 2)

      mock._triggerLine('{"type":"ping"}')
      mock._triggerLine('{"type":"pong"}')

      const chunks = await chunksPromise
      expect(dec.decode(chunks[0])).toBe('{"type":"ping"}\n')
      expect(dec.decode(chunks[1])).toBe('{"type":"pong"}\n')
    })

    it("subscribes to wire.onLine in constructor", () => {
      const mock = makeMockConnection()
      createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })
      expect(mock.onLine).toHaveBeenCalledOnce()
    })
  })

  describe("writable — Uint8Array → conn.wire.write with line-buffering", () => {
    // חוזה ה-wire של spawn (spawn-core.writeStdin כותב verbatim, "wrapper normalizes")
    // מחייב שורה מסיימת-\n — בדיוק כמו הנתיב המקומי (ws-agent.ts:170 מוסיף \n במפורש).
    // בלי ה-\n ה-CLI (readline/NDJSON) לא רואה שורה שלמה → initialize נתקע.
    it("writes a single complete line to conn.wire.write with \\n terminator", async () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const writer = transport.writable.getWriter()
      await writer.write(enc.encode('{"method":"prompt"}\n'))
      await writer.releaseLock()

      expect(mock.write).toHaveBeenCalledWith('{"method":"prompt"}\n')
    })

    it("buffers a partial chunk and flushes when \\n arrives in next write", async () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const writer = transport.writable.getWriter()
      // Simulate SDK sending {"me split across two chunks
      await writer.write(enc.encode('{"me'))
      await writer.write(enc.encode('thod":"x"}\n'))
      await writer.releaseLock()

      expect(mock.write).toHaveBeenCalledTimes(1)
      expect(mock.write).toHaveBeenCalledWith('{"method":"x"}\n')
    })

    it("handles multiple lines in a single chunk", async () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const writer = transport.writable.getWriter()
      await writer.write(enc.encode('{"id":1}\n{"id":2}\n'))
      await writer.releaseLock()

      expect(mock.write).toHaveBeenCalledTimes(2)
      expect(mock.write).toHaveBeenNthCalledWith(1, '{"id":1}\n')
      expect(mock.write).toHaveBeenNthCalledWith(2, '{"id":2}\n')
    })
  })

  describe("close()", () => {
    it("calling close() cancels the readable (done=true on next read)", async () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      transport.close()

      const reader = transport.readable.getReader()
      const { done } = await reader.read()
      reader.releaseLock()
      expect(done).toBe(true)
    })
  })

  describe("onClose — adapter: conn.onCrash → (code?, reason?)", () => {
    it("registers onClose callback via conn.onCrash", () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const onCloseCb = vi.fn()
      transport.onClose(onCloseCb)

      expect(mock.onCrash).toHaveBeenCalledOnce()
    })

    it("when conn crashes with exitCode, calls onClose(code, reason)", () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const onCloseCb = vi.fn()
      transport.onClose(onCloseCb)

      mock._triggerCrash({ exitCode: 1, signal: null })

      expect(onCloseCb).toHaveBeenCalledWith(1, expect.any(String))
    })

    it("when conn crashes with signal, calls onClose(1, signal-string)", () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const onCloseCb = vi.fn()
      transport.onClose(onCloseCb)

      mock._triggerCrash({ exitCode: null, signal: "SIGKILL" })

      expect(onCloseCb).toHaveBeenCalledWith(1, "SIGKILL")
    })

    it("when conn crashes cleanly (exitCode=0, no signal), calls onClose(0, '')", () => {
      const mock = makeMockConnection()
      const transport = createInProcessAcpTransport({ wire: mock, onCrash: mock.onCrash })

      const onCloseCb = vi.fn()
      transport.onClose(onCloseCb)

      mock._triggerCrash({ exitCode: 0, signal: null })

      expect(onCloseCb).toHaveBeenCalledWith(0, "")
    })
  })
})
