import { ACP_CONNECTION_ID, ACP_SESSION_ID } from "./headers.js"

export type HttpAcpClient = {
  initialize(params: unknown): Promise<{ connectionId: string; result: unknown }>
  request(method: string, params: unknown, opts?: { sessionId?: string }): Promise<unknown>
  sessionEvents(sessionId: string): AsyncIterable<unknown>
  close(): Promise<void>
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

function parseSetCookies(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie()
  }
  const raw = headers.get("set-cookie")
  return raw ? [raw] : []
}

function mergeCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const line of setCookies) {
    const part = line.split(";")[0]?.trim()
    if (!part) continue
    const eq = part.indexOf("=")
    if (eq === -1) continue
    jar.set(part.slice(0, eq), part.slice(eq + 1))
  }
}

function cookieHeader(jar: Map<string, string>): string | undefined {
  if (jar.size === 0) return undefined
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
}

function parseSseEvents(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = []
  let rest = buffer
  for (;;) {
    const sep = rest.indexOf("\n\n")
    if (sep === -1) break
    const block = rest.slice(0, sep)
    rest = rest.slice(sep + 2)
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) {
        const payload = line.slice("data: ".length)
        try {
          events.push(JSON.parse(payload))
        } catch {
          // skip malformed
        }
      }
    }
  }
  return { events, rest }
}

export function createHttpClient(baseUrl: string): HttpAcpClient {
  const jar = new Map<string, string>()
  let connectionId: string | undefined
  let closed = false

  const connectionPending = new Map<string | number, PendingRequest>()
  const sessionPending = new Map<string, Map<string | number, PendingRequest>>()

  let connectionSseAbort: AbortController | undefined
  let connectionSseBuffer = ""
  let connectionSseReady: Promise<void> | undefined

  const sessionSseAborts = new Map<string, AbortController>()
  const sessionSseBuffers = new Map<string, string>()
  const sessionSseReady = new Map<string, Promise<void>>()

  function dispatchConnectionEvent(msg: unknown): void {
    if (!msg || typeof msg !== "object") return
    const m = msg as Record<string, unknown>
    if (m.id !== undefined && connectionPending.has(m.id as string | number)) {
      const handlers = connectionPending.get(m.id as string | number)!
      connectionPending.delete(m.id as string | number)
      if ("error" in m && m.error) {
        handlers.reject(new Error(JSON.stringify(m.error)))
      } else {
        handlers.resolve(m.result)
      }
    }
  }

  function dispatchSessionEvent(sessionId: string, msg: unknown): void {
    if (!msg || typeof msg !== "object") return
    const m = msg as Record<string, unknown>
    const pending = sessionPending.get(sessionId)
    if (pending && m.id !== undefined && pending.has(m.id as string | number)) {
      const handlers = pending.get(m.id as string | number)!
      pending.delete(m.id as string | number)
      if ("error" in m && m.error) {
        handlers.reject(new Error(JSON.stringify(m.error)))
      } else {
        handlers.resolve(m.result)
      }
    }
  }

  async function readSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onEvent: (msg: unknown) => void,
    getBuffer: () => string,
    setBuffer: (v: string) => void,
  ): Promise<void> {
    const dec = new TextDecoder()
    try {
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        let buffer = getBuffer() + dec.decode(value, { stream: true })
        const { events, rest } = parseSseEvents(buffer)
        setBuffer(rest)
        for (const evt of events) {
          onEvent(evt)
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError" && !closed) {
        throw err
      }
    }
  }

  async function ensureConnectionSse(): Promise<void> {
    if (!connectionId || closed) return
    if (connectionSseReady) {
      await connectionSseReady
      return
    }

    connectionSseAbort = new AbortController()
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      [ACP_CONNECTION_ID]: connectionId,
    }
    const cookie = cookieHeader(jar)
    if (cookie) headers.Cookie = cookie

    connectionSseReady = (async () => {
      const res = await fetch(baseUrl, {
        method: "GET",
        headers,
        signal: connectionSseAbort!.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`connection SSE failed: ${res.status}`)
      }
      void readSseStream(
        res.body.getReader(),
        dispatchConnectionEvent,
        () => connectionSseBuffer,
        (v) => {
          connectionSseBuffer = v
        },
      )
    })()

    await connectionSseReady
  }

  async function ensureSessionSse(sessionId: string): Promise<void> {
    if (!connectionId || closed) return
    if (sessionSseReady.has(sessionId)) {
      await sessionSseReady.get(sessionId)
      return
    }

    const abort = new AbortController()
    sessionSseAborts.set(sessionId, abort)
    sessionSseBuffers.set(sessionId, "")

    const promise = (async () => {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        [ACP_CONNECTION_ID]: connectionId!,
        [ACP_SESSION_ID]: sessionId,
      }
      const cookie = cookieHeader(jar)
      if (cookie) headers.Cookie = cookie

      const res = await fetch(baseUrl, {
        method: "GET",
        headers,
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`session SSE failed: ${res.status}`)
      }
      void readSseStream(
        res.body.getReader(),
        (msg) => dispatchSessionEvent(sessionId, msg),
        () => sessionSseBuffers.get(sessionId) ?? "",
        (v) => {
          sessionSseBuffers.set(sessionId, v)
        },
      )
    })()

    sessionSseReady.set(sessionId, promise)
    await promise
  }

  let nextId = 1

  async function postRpc(
    body: unknown,
    opts?: { sessionId?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (connectionId) {
      headers[ACP_CONNECTION_ID] = connectionId
    }
    if (opts?.sessionId) {
      headers[ACP_SESSION_ID] = opts.sessionId
    }
    const cookie = cookieHeader(jar)
    if (cookie) headers.Cookie = cookie

    return fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  }

  return {
    async initialize(params) {
      const id = nextId++
      const res = await postRpc({ jsonrpc: "2.0", id, method: "initialize", params })
      if (res.status !== 200) {
        throw new Error(`initialize failed: ${res.status}`)
      }

      mergeCookies(jar, parseSetCookies(res.headers))
      const connHeader = res.headers.get(ACP_CONNECTION_ID)
      if (!connHeader) {
        throw new Error("missing Acp-Connection-Id header")
      }
      connectionId = connHeader

      const body = (await res.json()) as Record<string, unknown>
      const result = body.result

      void ensureConnectionSse().catch(() => {})

      return {
        connectionId: connHeader,
        result,
      }
    },

    async request(method, params, opts) {
      if (!connectionId) {
        throw new Error("not initialized")
      }

      const id = nextId++
      const sessionId = opts?.sessionId

      const waitPromise = new Promise<unknown>((resolve, reject) => {
        const handlers = { resolve, reject }
        if (sessionId) {
          if (!sessionPending.has(sessionId)) {
            sessionPending.set(sessionId, new Map())
          }
          sessionPending.get(sessionId)!.set(id, handlers)
        } else {
          connectionPending.set(id, handlers)
        }
      })

      if (sessionId) {
        void ensureSessionSse(sessionId).catch(() => {})
      }

      // Allow connection/session SSE streams to attach before the agent responds.
      await new Promise((r) => setTimeout(r, 20))

      const res = await postRpc(
        { jsonrpc: "2.0", id, method, params },
        { sessionId },
      )

      if (res.status !== 202) {
        throw new Error(`request ${method} failed: ${res.status}`)
      }

      return waitPromise
    },

    async *sessionEvents(sessionId) {
      if (!connectionId) {
        throw new Error("not initialized")
      }

      const abort = new AbortController()
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        [ACP_CONNECTION_ID]: connectionId,
        [ACP_SESSION_ID]: sessionId,
      }
      const cookie = cookieHeader(jar)
      if (cookie) headers.Cookie = cookie

      const res = await fetch(baseUrl, {
        method: "GET",
        headers,
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`sessionEvents SSE failed: ${res.status}`)
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buffer = ""

      try {
        while (!closed) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += dec.decode(value, { stream: true })
          const { events, rest } = parseSseEvents(buffer)
          buffer = rest
          for (const evt of events) {
            yield evt
          }
        }
      } finally {
        abort.abort()
      }
    },

    async close() {
      if (closed) return
      closed = true

      connectionSseAbort?.abort()
      for (const abort of sessionSseAborts.values()) {
        abort.abort()
      }

      if (connectionId) {
        const headers: Record<string, string> = {
          [ACP_CONNECTION_ID]: connectionId,
        }
        const cookie = cookieHeader(jar)
        if (cookie) headers.Cookie = cookie
        try {
          await fetch(baseUrl, { method: "DELETE", headers })
        } catch {
          // best-effort
        }
      }
    },
  }
}
