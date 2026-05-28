/**
 * client.test.ts — Tests for createAcpClient via MockAcpTransport.
 *
 * The mock transport lets us drive the protocol end-to-end without WebSocket
 * or child process I/O. We:
 *   1. Construct MockAcpTransport.
 *   2. Start createAcpClient(mock, ...).
 *   3. Wait for the SDK to write its `initialize` request to `sentFrames`.
 *   4. Parse the request to extract the JSON-RPC id.
 *   5. Emit a matching response via `mock.emitFrame()`.
 *   6. Await the createAcpClient promise — resolves with the client.
 *
 * This pattern is reusable for any ACP method exercised in tests.
 */

import { describe, expect, test } from "vitest"
import { createAcpClient } from "../../src/acp/client.js"
import { MockAcpTransport } from "../../src/acp/transport-mock.js"

// Microtask flush helper — lets the SDK's stream reader process pending writes.
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

// Build a minimal valid initialize response that satisfies the SDK shape.
function makeInitResponse(id: number) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { audio: false, image: false, embeddedContext: false },
      },
      authMethods: [],
    },
  })
}

describe("createAcpClient — happy path", () => {
  test("sends initialize, returns client when agent responds", async () => {
    const transport = new MockAcpTransport()
    const updates: unknown[] = []

    const clientPromise = createAcpClient(transport, (n) => updates.push(n))

    // Wait for SDK to write the initialize request
    await flush()
    expect(transport.sentFrames).toHaveLength(1)

    const initReq = JSON.parse(transport.sentFrames[0] ?? "") as {
      method: string
      id: number
      params: { protocolVersion: number; clientCapabilities: unknown }
    }
    expect(initReq.method).toBe("initialize")
    expect(initReq.params.protocolVersion).toBe(1)
    expect(initReq.params.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
    })

    transport.emitFrame(makeInitResponse(initReq.id))

    const client = await clientPromise
    expect(client.capabilities).toBeDefined()
    expect(client.conn).toBeDefined()
  })

  test("forwards sessionUpdate notifications to onUpdate", async () => {
    const transport = new MockAcpTransport()
    const updates: Array<Record<string, unknown>> = []

    const clientPromise = createAcpClient(transport, (n) =>
      updates.push(n as unknown as Record<string, unknown>),
    )
    await flush()
    const initReq = JSON.parse(transport.sentFrames[0] ?? "") as { id: number }
    transport.emitFrame(makeInitResponse(initReq.id))
    await clientPromise

    // Emit a session/update notification (no id — it's a notification).
    // JSON-RPC method is "session/update" (with slash); the `update.sessionUpdate`
    // field inside params is the notification kind.
    transport.emitFrame(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        },
      }),
    )
    await flush()

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      sessionId: "sess-1",
      update: { sessionUpdate: "agent_message_chunk" },
    })
  })
})

describe("createAcpClient — timeout", () => {
  // Tests use initTimeoutMs: 50 instead of fake timers — Promise.race + fake
  // timers triggers spurious unhandled-rejection reports in vitest 4.x.
  // 50ms is well above microtask noise and fast enough for tests.
  const TIMEOUT = 50

  test("throws ACP initialize timeout when no response arrives in time", async () => {
    const transport = new MockAcpTransport()
    const clientPromise = createAcpClient(transport, () => {}, { initTimeoutMs: TIMEOUT })

    await expect(clientPromise).rejects.toThrow(/ACP initialize timeout/)
  })

  test("closes the transport on timeout", async () => {
    const transport = new MockAcpTransport()
    let closed = false
    transport.onClose(() => {
      closed = true
    })

    const clientPromise = createAcpClient(transport, () => {}, { initTimeoutMs: TIMEOUT })
    await expect(clientPromise).rejects.toThrow()

    expect(closed).toBe(true)
  })
})

describe("createAcpClient — auth_required", () => {
  test("rethrows with kind=auth_required when agent responds with auth error", async () => {
    const transport = new MockAcpTransport()
    const clientPromise = createAcpClient(transport, () => {})

    await flush()
    const initReq = JSON.parse(transport.sentFrames[0] ?? "") as { id: number }

    // Respond with auth_required error
    transport.emitFrame(
      JSON.stringify({
        jsonrpc: "2.0",
        id: initReq.id,
        error: {
          code: -32603,
          message: "Authentication required",
          data: { code: "auth_required" },
        },
      }),
    )

    let caught: (Error & { kind?: string }) | undefined
    try {
      await clientPromise
    } catch (e) {
      caught = e as Error & { kind?: string }
    }

    expect(caught).toBeDefined()
    expect(caught?.kind).toBe("auth_required")
    expect(caught?.message).toMatch(/ACP agent requires authentication/)
  })
})

describe("createAcpClient — public methods", () => {
  async function makeReadyClient() {
    const transport = new MockAcpTransport()
    const clientPromise = createAcpClient(transport, () => {})
    await flush()
    const initReq = JSON.parse(transport.sentFrames[0] ?? "") as { id: number }
    transport.emitFrame(makeInitResponse(initReq.id))
    const client = await clientPromise
    // Reset sentFrames so tests can assert on post-init frames only
    transport.sentFrames.length = 0
    return { transport, client }
  }

  test("close() calls transport.close()", async () => {
    const { transport, client } = await makeReadyClient()
    let closed = false
    transport.onClose(() => {
      closed = true
    })
    client.close()
    expect(closed).toBe(true)
  })

  test("newSession sends correct JSON-RPC", async () => {
    const { transport, client } = await makeReadyClient()
    void client.newSession({ cwd: "/tmp/x" })
    await flush()
    expect(transport.sentFrames).toHaveLength(1)
    const frame = JSON.parse(transport.sentFrames[0] ?? "") as {
      method: string
      params: { cwd: string; mcpServers: unknown[] }
    }
    expect(frame.method).toBe("session/new")
    expect(frame.params.cwd).toBe("/tmp/x")
    expect(frame.params.mcpServers).toEqual([])
  })

  test("prompt sends text content block in the right shape", async () => {
    const { transport, client } = await makeReadyClient()
    void client.prompt("sess-1", "hello")
    await flush()
    expect(transport.sentFrames).toHaveLength(1)
    const frame = JSON.parse(transport.sentFrames[0] ?? "") as {
      method: string
      params: { sessionId: string; prompt: Array<{ type: string; text: string }> }
    }
    expect(frame.method).toBe("session/prompt")
    expect(frame.params.sessionId).toBe("sess-1")
    expect(frame.params.prompt).toEqual([{ type: "text", text: "hello" }])
  })

  test("cancel sends session/cancel", async () => {
    const { transport, client } = await makeReadyClient()
    void client.cancel("sess-1")
    await flush()
    expect(transport.sentFrames).toHaveLength(1)
    const frame = JSON.parse(transport.sentFrames[0] ?? "") as {
      method: string
      params: { sessionId: string }
    }
    expect(frame.method).toBe("session/cancel")
    expect(frame.params.sessionId).toBe("sess-1")
  })
})
