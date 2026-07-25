/**
 * client.delete-session.test.ts — integration: AcpClient.deleteSession(sessionId).
 *
 * Slice session-delete, Commit 0.
 *
 * `session/delete` (ACP) מסיר סשן מ-`session/list` — שונה מ-kill-process (`DELETE /api/agents/:id`).
 * הפייסייד עוטף `conn.deleteSession({sessionId})` ומחזיר `void` (DeleteSessionResponse הוא `{}`).
 *
 * Tests:
 *   1. deleteSession(id) writes a frame containing "session/delete" + sessionId
 *   2. AcpClient interface exposes deleteSession as a function (type-level via runtime check)
 */

import { describe, expect, it } from "vitest"
import type { AcpTransport } from "../transport/types.js"
import { createAttachedAcpClient } from "./client.js"

// ─── transport double (same pattern as client.attached.test.ts) ──────────────

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

describe("AcpClient.deleteSession", () => {
  it("writes a frame containing 'session/delete' and the sessionId", async () => {
    const { transport, written } = makeTransportDouble()
    const client = createAttachedAcpClient(transport, () => {})

    // Fire deleteSession — don't await (no server to respond); just verify the frame is enqueued.
    void client.deleteSession("session-123")

    await Promise.resolve()

    const frame = joinWritten(written)
    expect(frame).toContain("session/delete")
    expect(frame).toContain("session-123")
  })

  it("exposes deleteSession as a function on the facade", () => {
    const { transport } = makeTransportDouble()
    const client = createAttachedAcpClient(transport, () => {})

    expect(typeof client.deleteSession).toBe("function")
  })
})
