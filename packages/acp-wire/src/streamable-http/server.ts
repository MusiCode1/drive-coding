import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import type { AcpTransport } from "../transport/types.js"
import {
  ACP_CONNECTION_ID,
  ACP_PATH,
  ACP_SESSION_ID,
  FORBIDDEN_HTTP_PORTS,
} from "./headers.js"
import { inboundKind, outboundSink } from "./routing.js"

/**
 * Deviation from RFD Streamable HTTP (2026-08-31):
 * https://agentclientprotocol.com/rfds/streamable-http-websocket-transport
 *
 * The RFD requires HTTP/2 for multiplexing POST+GET on one TCP connection.
 * This slice uses node:http createServer on 127.0.0.1 with OS-assigned port,
 * HTTP/1.1 only — parallel POST and GET use separate TCP connections.
 */

export type HttpListenHandle = {
  readonly url: string
  readonly port: number
  readonly transport: AcpTransport
  close(): void
}

type SseClient = {
  write(data: string): void
  close(): void
}

type ActiveConnection = {
  id: string
  connectionStreams: Set<SseClient>
  sessionStreams: Map<string, Set<SseClient>>
  requestSessionById: Map<string, string>
  initializePending?: {
    id: unknown
    resolve: (result: unknown) => void
    reject: (err: Error) => void
  }
}

type InternalTransport = AcpTransport & {
  pushInbound(line: string): void
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()]
  if (typeof raw === "string") {
    return raw
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw[0]
  }
  return undefined
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function parseJsonRpcBody(body: string): {
  batch: boolean
  method?: string
  id?: unknown
  raw: unknown
} {
  const parsed = JSON.parse(body) as unknown
  if (Array.isArray(parsed)) {
    return { batch: true, raw: parsed }
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>
    return {
      batch: false,
      method: typeof obj.method === "string" ? obj.method : undefined,
      id: obj.id,
      raw: parsed,
    }
  }
  return { batch: false, raw: parsed }
}

function sseAttach(res: ServerResponse): SseClient {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  return {
    write(data: string) {
      if (!res.writableEnded) {
        res.write(data)
      }
    },
    close() {
      if (!res.writableEnded) {
        res.end()
      }
    },
  }
}

function emitSse(clients: Iterable<SseClient>, payload: unknown): void {
  const frame = `data: ${JSON.stringify(payload)}\n\n`
  for (const client of clients) {
    client.write(frame)
  }
}

function closeAllSse(clients: Iterable<SseClient>): void {
  for (const client of clients) {
    client.close()
  }
}

function createInternalTransport(onOutboundLine: (line: string) => void): InternalTransport {
  let readableController: ReadableStreamDefaultController<Uint8Array> | undefined
  let closeCb: ((code: number, reason: string) => void) | undefined
  let closed = false
  const enc = new TextEncoder()
  let lineBuffer = ""

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readableController = controller
    },
  })

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      lineBuffer += new TextDecoder().decode(chunk)
      for (;;) {
        const nl = lineBuffer.indexOf("\n")
        if (nl === -1) break
        const line = lineBuffer.slice(0, nl)
        lineBuffer = lineBuffer.slice(nl + 1)
        if (line.length > 0) {
          onOutboundLine(line)
        }
      }
    },
    close() {
      lineBuffer = ""
    },
  })

  const transport: InternalTransport = {
    readable,
    writable,
    close() {
      if (closed) return
      closed = true
      try {
        readableController?.close()
      } catch {
        // already closed
      }
      closeCb?.(0, "transport closed")
    },
    onClose(cb) {
      closeCb = cb
    },
    pushInbound(line: string) {
      if (closed) return
      readableController?.enqueue(enc.encode(`${line}\n`))
    },
  }

  return transport
}

export function listenHttp(opts?: { port?: number; host?: string }): Promise<HttpListenHandle> {
  const host = opts?.host ?? "127.0.0.1"
  const requestedPort = opts?.port ?? 0

  if (FORBIDDEN_HTTP_PORTS.includes(requestedPort as (typeof FORBIDDEN_HTTP_PORTS)[number])) {
    return Promise.reject(new Error(`forbidden HTTP port: ${requestedPort}`))
  }

  let active: ActiveConnection | undefined
  let httpServer: ReturnType<typeof createServer> | undefined
  let transport: InternalTransport | undefined

  function routeOutbound(line: string): void {
    if (!active) return
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    const sink = outboundSink(msg)

    if (sink === "initialize-response") {
      const pending = active.initializePending
      if (pending) {
        const msgObj = msg as Record<string, unknown>
        if (msgObj.id === pending.id && "result" in msgObj) {
          active.initializePending = undefined
          pending.resolve(msgObj.result)
          return
        }
      }
    }

    if (sink === "session") {
      let targetSessionId = extractSessionId(msg)
      if (!targetSessionId && active) {
        const msgObj = msg as Record<string, unknown>
        if (msgObj.id !== undefined) {
          targetSessionId = active.requestSessionById.get(String(msgObj.id))
        }
      }
      if (targetSessionId) {
        const streams = active.sessionStreams.get(targetSessionId)
        if (streams && streams.size > 0) {
          emitSse(streams, msg)
          return
        }
      }
    }

    emitSse(active.connectionStreams, msg)
  }

  transport = createInternalTransport(routeOutbound)

  function teardownConnection(): void {
    if (!active) return
    closeAllSse(active.connectionStreams)
    for (const streams of active.sessionStreams.values()) {
      closeAllSse(streams)
    }
    active.initializePending?.reject(new Error("connection closed"))
    active = undefined
  }

  httpServer = createServer(async (req, res) => {
    if (req.url?.split("?")[0] !== ACP_PATH) {
      res.writeHead(404)
      res.end()
      return
    }

    const connectionId = headerValue(req, ACP_CONNECTION_ID)
    const sessionId = headerValue(req, ACP_SESSION_ID)
    const accept = headerValue(req, "accept") ?? ""
    const contentType = headerValue(req, "content-type") ?? ""

    if (req.method === "GET") {
      if (!accept.includes("text/event-stream")) {
        res.writeHead(406)
        res.end()
        return
      }

      const kind = inboundKind({
        method: req.method,
        connectionId,
        sessionId,
      })

      if (kind === "invalid") {
        res.writeHead(400)
        res.end()
        return
      }

      if (!active || active.id !== connectionId) {
        res.writeHead(404)
        res.end()
        return
      }

      if (kind === "sse-session") {
        if (!sessionId) {
          res.writeHead(400)
          res.end()
          return
        }
        let streams = active.sessionStreams.get(sessionId)
        if (!streams) {
          streams = new Set()
          active.sessionStreams.set(sessionId, streams)
        }
        const client = sseAttach(res)
        streams.add(client)
        req.on("close", () => {
          streams?.delete(client)
        })
        return
      }

      const client = sseAttach(res)
      active.connectionStreams.add(client)
      req.on("close", () => {
        active?.connectionStreams.delete(client)
      })
      return
    }

    if (req.method === "DELETE") {
      if (!connectionId || !active || active.id !== connectionId) {
        res.writeHead(404)
        res.end()
        return
      }
      teardownConnection()
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== "POST") {
      res.writeHead(405)
      res.end()
      return
    }

    if (!contentType.includes("application/json")) {
      res.writeHead(415)
      res.end()
      return
    }

    let body: string
    try {
      body = await readBody(req)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }

    let parsed: ReturnType<typeof parseJsonRpcBody>
    try {
      parsed = parseJsonRpcBody(body)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }

    if (parsed.batch) {
      res.writeHead(501)
      res.end()
      return
    }

    const kind = inboundKind({
      method: req.method,
      connectionId,
      sessionId,
      rpcMethod: parsed.method,
    })

    if (kind === "invalid") {
      res.writeHead(400)
      res.end()
      return
    }

    if (kind === "initialize") {
      if (active) {
        res.writeHead(409)
        res.end()
        return
      }

      const newConnectionId = randomUUID()
      active = {
        id: newConnectionId,
        connectionStreams: new Set(),
        sessionStreams: new Map(),
        requestSessionById: new Map(),
      }

      const line = body.trim()
      transport!.pushInbound(line)

      try {
        const result = await new Promise<unknown>((resolve, reject) => {
          active!.initializePending = {
            id: parsed.id,
            resolve,
            reject,
          }
          setTimeout(() => {
            if (active?.initializePending?.id === parsed.id) {
              active!.initializePending = undefined
              reject(new Error("initialize timeout"))
            }
          }, 30_000)
        })

        const enriched = {
          ...(typeof result === "object" && result !== null
            ? (result as Record<string, unknown>)
            : { value: result }),
          connectionId: newConnectionId,
        }

        res.writeHead(200, {
          "Content-Type": "application/json",
          [ACP_CONNECTION_ID]: newConnectionId,
          "Set-Cookie": `acp-connection=${newConnectionId}; Path=${ACP_PATH}; HttpOnly`,
        })
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: enriched,
          }),
        )
      } catch {
        teardownConnection()
        res.writeHead(500)
        res.end()
      }
      return
    }

    if (!active || active.id !== connectionId) {
      res.writeHead(404)
      res.end()
      return
    }

    if (kind === "post") {
      if (sessionId && parsed.id !== undefined) {
        active!.requestSessionById.set(String(parsed.id), sessionId)
      }
      transport!.pushInbound(body.trim())
      res.writeHead(202)
      res.end()
      return
    }

    res.writeHead(400)
    res.end()
  })

  return new Promise((resolve, reject) => {
    httpServer!.once("error", reject)
    httpServer!.listen(requestedPort, host, () => {
      const addr = httpServer!.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind HTTP server"))
        return
      }

      const boundPort = addr.port
      if (
        FORBIDDEN_HTTP_PORTS.includes(boundPort as (typeof FORBIDDEN_HTTP_PORTS)[number])
      ) {
        httpServer!.close()
        reject(new Error(`forbidden HTTP port: ${boundPort}`))
        return
      }

      resolve({
        url: `http://${host}:${boundPort}${ACP_PATH}`,
        port: boundPort,
        transport: transport!,
        close() {
          teardownConnection()
          httpServer!.close()
          transport!.close()
        },
      })
    })
  })
}

function extractSessionId(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") return undefined
  const m = msg as Record<string, unknown>
  if (m.params && typeof m.params === "object") {
    const params = m.params as Record<string, unknown>
    if (typeof params.sessionId === "string") {
      return params.sessionId
    }
  }
  if (m.result && typeof m.result === "object") {
    const result = m.result as Record<string, unknown>
    if (typeof result.sessionId === "string") {
      return result.sessionId
    }
  }
  return undefined
}
