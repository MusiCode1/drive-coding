import { describe, expect, it } from "vitest"
import { createHttpClient } from "./client.js"
import { ACP_CONNECTION_ID, ACP_PATH, FORBIDDEN_HTTP_PORTS } from "./headers.js"
import { inboundKind, outboundSink } from "./routing.js"
import { listenHttp } from "./server.js"

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Minimal agent loop: reads NDJSON from transport.readable, writes responses to writable. */
async function runAgentLoop(
  transport: {
    readable: ReadableStream<Uint8Array>
    writable: WritableStream<Uint8Array>
  },
  handler: (method: string, params: unknown, id: unknown) => unknown | Promise<unknown>,
): Promise<void> {
  const reader = transport.readable.getReader()
  const writer = transport.writable.getWriter()
  let buffer = ""

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += dec.decode(value)
      for (;;) {
        const nl = buffer.indexOf("\n")
        if (nl === -1) break
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue

        const msg = JSON.parse(line) as {
          method?: string
          params?: unknown
          id?: unknown
        }
        if (!msg.method) continue

        const result = await handler(msg.method, msg.params ?? {}, msg.id)

        if (msg.method === "session/prompt") {
          const params = msg.params as { sessionId?: string }
          await writer.write(
            enc.encode(
              `${JSON.stringify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: params.sessionId,
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: "hello" },
                  },
                },
              })}\n`,
            ),
          )
        }

        await writer.write(
          enc.encode(
            `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`,
          ),
        )
      }
    }
  } finally {
    reader.releaseLock()
    writer.releaseLock()
  }
}

describe("routing", () => {
  it("classifies inbound HTTP kinds", () => {
    expect(
      inboundKind({ method: "POST", rpcMethod: "initialize" }),
    ).toBe("initialize")
    expect(
      inboundKind({ method: "POST", connectionId: "c1", rpcMethod: "session/new" }),
    ).toBe("post")
    expect(
      inboundKind({ method: "GET", connectionId: "c1" }),
    ).toBe("sse-connection")
    expect(
      inboundKind({ method: "GET", connectionId: "c1", sessionId: "s1" }),
    ).toBe("sse-session")
    expect(inboundKind({ method: "DELETE" })).toBe("delete")
    expect(inboundKind({ method: "GET" })).toBe("invalid")
  })

  it("classifies outbound sinks", () => {
    expect(
      outboundSink({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } }),
    ).toBe("initialize-response")
    expect(
      outboundSink({ jsonrpc: "2.0", id: 2, result: { sessionId: "s1", modes: [] } }),
    ).toBe("connection")
    expect(
      outboundSink({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "s1", update: {} },
      }),
    ).toBe("session")
    expect(
      outboundSink({ jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } }),
    ).toBe("session")
  })
})

describe("streamable-http", () => {
  it("initialize returns 200 with connection header and Set-Cookie", async () => {
    const handle = await listenHttp({ port: 0 })
    const agentPromise = runAgentLoop(handle.transport, async (method) => {
      if (method === "initialize") {
        return { protocolVersion: 1, agentCapabilities: {} }
      }
      return {}
    })

    const client = createHttpClient(handle.url)
    const { connectionId, result } = await client.initialize({ protocolVersion: 1 })
    expect(connectionId).toBeTruthy()
    expect((result as { protocolVersion?: number }).protocolVersion).toBe(1)
    expect((result as { connectionId?: string }).connectionId).toBe(connectionId)

    await client.close()
    handle.close()
    await agentPromise.catch(() => {})

    const handle2 = await listenHttp({ port: 0 })
    const agent2 = runAgentLoop(handle2.transport, async (method) => {
      if (method === "initialize") return { protocolVersion: 1 }
      return {}
    })
    const initRes = await fetch(handle2.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1 },
      }),
    })
    const setCookies =
      typeof initRes.headers.getSetCookie === "function"
        ? initRes.headers.getSetCookie()
        : [initRes.headers.get("set-cookie")].filter(Boolean)
    expect(setCookies.some((c) => c?.includes("acp-connection"))).toBe(true)
    handle2.close()
    await agent2.catch(() => {})
  })

  it("session/new returns 202 and sessionId on connection SSE", async () => {
    const handle = await listenHttp({ port: 0 })
    const agentPromise = runAgentLoop(handle.transport, async (method) => {
      if (method === "initialize") {
        return { protocolVersion: 1 }
      }
      if (method === "session/new") {
        return { sessionId: "sess-abc", modes: [], configOptions: [] }
      }
      return {}
    })

    const client = createHttpClient(handle.url)
    await client.initialize({ protocolVersion: 1 })
    const session = (await client.request("session/new", {
      cwd: "/tmp",
      mcpServers: [],
    })) as { sessionId?: string }

    expect(session.sessionId).toBe("sess-abc")

    await client.close()
    handle.close()
    await agentPromise.catch(() => {})
  })

  it("prompt returns chunk and end_turn on session SSE", async () => {
    const handle = await listenHttp({ port: 0 })
    const agentPromise = runAgentLoop(handle.transport, async (method) => {
      if (method === "initialize") {
        return { protocolVersion: 1 }
      }
      if (method === "session/new") {
        return { sessionId: "sess-abc", modes: [], configOptions: [] }
      }
      if (method === "session/prompt") {
        return { stopReason: "end_turn" }
      }
      return {}
    })

    const client = createHttpClient(handle.url)
    await client.initialize({ protocolVersion: 1 })
    const session = (await client.request("session/new", {
      cwd: "/tmp",
      mcpServers: [],
    })) as { sessionId: string }

    const events: unknown[] = []
    const eventsDone = (async () => {
      for await (const evt of client.sessionEvents(session.sessionId)) {
        events.push(evt)
        if (
          evt &&
          typeof evt === "object" &&
          "result" in evt &&
          (evt as { result?: { stopReason?: string } }).result?.stopReason === "end_turn"
        ) {
          break
        }
      }
    })()

    const prompt = (await client.request(
      "session/prompt",
      {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hi" }],
      },
      { sessionId: session.sessionId },
    )) as { stopReason?: string }

    await Promise.race([
      eventsDone,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("events timeout")), 3000),
      ),
    ])

    expect(prompt.stopReason).toBe("end_turn")
    const sawChunk = events.some(
      (evt) =>
        evt &&
        typeof evt === "object" &&
        (evt as { method?: string }).method === "session/update" &&
        (evt as { params?: { update?: { sessionUpdate?: string } } }).params?.update
          ?.sessionUpdate === "agent_message_chunk",
    )
    expect(sawChunk).toBe(true)

    await client.close()
    handle.close()
    await agentPromise.catch(() => {})
  }, 10_000)

  it("rejects forbidden ports", async () => {
    for (const port of FORBIDDEN_HTTP_PORTS) {
      await expect(listenHttp({ port })).rejects.toThrow(/forbidden HTTP port/)
    }
  })

  it("returns error status codes for bad requests", async () => {
    const handle = await listenHttp({ port: 0 })

    const base = handle.url.replace(ACP_PATH, "")

    const notFound = await fetch(`${base}/other`, { method: "POST" })
    expect(notFound.status).toBe(404)

    const badContent = await fetch(handle.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "x",
    })
    expect(badContent.status).toBe(415)

    const badAccept = await fetch(handle.url, {
      method: "GET",
      headers: { [ACP_CONNECTION_ID]: "missing", Accept: "application/json" },
    })
    expect(badAccept.status).toBe(406)

    const batch = await fetch(handle.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    })
    expect(batch.status).toBe(501)

    const noConn = await fetch(handle.url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    })
    expect(noConn.status).toBe(400)

    const unknownConn = await fetch(handle.url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        [ACP_CONNECTION_ID]: "00000000-0000-0000-0000-000000000000",
      },
    })
    expect(unknownConn.status).toBe(404)

    handle.close()
  })

  it("client sends stored Cookie on subsequent requests", async () => {
    const handle = await listenHttp({ port: 0 })
    const agentPromise = runAgentLoop(handle.transport, async (method) => {
      if (method === "initialize") {
        return { protocolVersion: 1 }
      }
      if (method === "session/new") {
        return { sessionId: "sess-cookie", modes: [], configOptions: [] }
      }
      return {}
    })

    const seenCookies: string[] = []
    const origFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const headers = init?.headers
      if (headers && typeof headers === "object" && !Array.isArray(headers)) {
        const cookie = (headers as Record<string, string>).Cookie
        if (cookie) seenCookies.push(cookie)
      }
      return origFetch(input, init)
    }

    try {
      const client = createHttpClient(handle.url)
      await client.initialize({ protocolVersion: 1 })
      await client.request("session/new", { cwd: "/tmp", mcpServers: [] })
      expect(seenCookies.some((c) => c.includes("acp-connection"))).toBe(true)
      await client.close()
    } finally {
      globalThis.fetch = origFetch
    }

    handle.close()
    await agentPromise.catch(() => {})
  })
})
