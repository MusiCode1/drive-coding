/**
 * client.fork-session.test.ts — integration: AcpClient.forkSession(opts).
 *
 * Slice session-fork-ui, Commit 0.
 *
 * `session/fork` (ACP, `unstable_forkSession`) יוצר session **חדש** שממשיך מאותה נקודה —
 * שונה מ-`loadSession` (טוען את *אותו* id). הפייסייד עוטף `conn.unstable_forkSession({sessionId, cwd, mcpServers:[]})`.
 *
 * Tests:
 *   1. forkSession({cwd,sessionId}) writes a frame containing "session/fork", the sessionId, and cwd
 *   2. AcpClient interface exposes forkSession as a function (type-level via runtime check)
 */

import { describe, expect, it } from "vitest"
import type { AcpTransport } from "../transport/types.js"
import { createAttachedAcpClient } from "./client.js"

// ─── transport double (same pattern as client.delete-session.test.ts) ────────

function makeTransportDouble() {
  const written: string[] = []
  const dec = new TextDecoder()
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(dec.decode(chunk))
    },
  })

  const readable = new ReadableStream<Uint8Array>({
    start() {},
  })

  const transport: AcpTransport = {
    readable,
    writable,
    close() {},
    onClose(_cb) {},
  }

  return { transport, written }
}

function joinWritten(written: string[]) {
  return written.join("")
}

describe("AcpClient.forkSession", () => {
  it("writes a frame containing 'session/fork', the sessionId, and cwd", async () => {
    const { transport, written } = makeTransportDouble()
    const client = createAttachedAcpClient(transport, () => {})

    // Fire forkSession — don't await (no server to respond); just verify the frame is enqueued.
    void client.forkSession({ cwd: "/tmp/proj", sessionId: "session-123" })

    await Promise.resolve()

    const frame = joinWritten(written)
    expect(frame).toContain("session/fork")
    expect(frame).toContain("session-123")
    expect(frame).toContain("/tmp/proj")
  })

  it("exposes forkSession as a function on the facade", () => {
    const { transport } = makeTransportDouble()
    const client = createAttachedAcpClient(transport, () => {})

    expect(typeof client.forkSession).toBe("function")
  })
})
