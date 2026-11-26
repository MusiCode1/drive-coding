import { WS_SESSION_PATH_PREFIX } from "@drive-coding/core/session"
import { beUrl, beWsUrl } from "$lib/util/be-url.js"
import { RemoteSessionView, type RemoteViewOptions } from "./remote-session-view.js"
import type { SessionTransport } from "./session-transport.js"
import { createHttpHistoryPipe } from "./wire/http-history-pipe"
import { createHttpRpcPipe } from "./wire/http-rpc-pipe"
import type { SSEReaderOptions } from "./wire/reader-types"
import { createSseFramePipe } from "./wire/sse-pipe"
import { createWsSessionPipe } from "./wire/ws-pipe"

export const ACP_CONNECTION_ID_HEADER = "Acp-Connection-Id"

export type RemoteSessionViewOptions = RemoteViewOptions &
  Pick<SSEReaderOptions, "headers" | "_fetch"> & {
    _WebSocket?: typeof WebSocket
  }

function resolveConnectionId(opts: RemoteSessionViewOptions): string {
  return (
    opts.headers?.[ACP_CONNECTION_ID_HEADER] ??
    opts.connectionId ??
    (typeof crypto !== "undefined" ? crypto.randomUUID() : "remote-view")
  )
}

function targetBackendBase(connectionBase: string): string | undefined {
  const page = typeof location === "undefined" ? undefined : location
  try {
    const url = new URL(connectionBase || "/", page?.href ?? page?.origin)
    if (url.search || url.hash) return
    if (url.protocol === "ws:") url.protocol = "http:"
    if (url.protocol === "wss:") url.protocol = "https:"
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin + url.pathname.replace(/\/$/, "")
    }
  } catch {
    // No verifiable namespace for a malformed base or an SSR-relative URL.
    return undefined
  }
}

/** Constructs the HTTP/SSE view. The caller connects it when ready. */
export function createRemoteSessionView(
  agentId: string,
  baseUrl: string,
  opts: RemoteSessionViewOptions = {},
): RemoteSessionView {
  const connectionId = resolveConnectionId(opts)
  const wireOptions = {
    _fetch: opts._fetch,
    headers: { [ACP_CONNECTION_ID_HEADER]: connectionId, ...opts.headers },
  }
  const agentUrl = `${baseUrl}/api/agents/${agentId}`
  const eventsUrl = `${agentUrl}/events?snapshot=meta`
  const pipe = {
    frames: createSseFramePipe(eventsUrl, wireOptions),
    rpc: createHttpRpcPipe(agentUrl, wireOptions),
    history: createHttpHistoryPipe(`${agentUrl}/history`, wireOptions),
    close() {}, // FrameReader owns and aborts the SSE request.
  }
  return new RemoteSessionView(agentId, pipe, {
    ...opts,
    baseUrl,
    connectionId,
    targetBackendBaseUrl: targetBackendBase(baseUrl),
  })
}

export async function createRemoteView(
  opts: {
    agentId: string
    baseUrl?: string
    transport?: SessionTransport
  } & RemoteSessionViewOptions,
): Promise<RemoteSessionView> {
  const { agentId, baseUrl, transport = "http", ...rest } = opts
  // beUrl("") adds a trailing slash for same-origin, so normalize before appending /api or /ws.
  const base = baseUrl?.replace(/\/$/, "")
  let view: RemoteSessionView
  if (transport === "ws") {
    const connectionId = resolveConnectionId(rest)
    const wireHeaders = {
      [ACP_CONNECTION_ID_HEADER]: connectionId,
      ...rest.headers,
    }
    const query = new URLSearchParams({ connectionId, snapshot: "meta" })
    const path = `${WS_SESSION_PATH_PREFIX}${encodeURIComponent(agentId)}?${query}`
    const url = base ? base.replace(/^http/, "ws") + path : beWsUrl(path)
    const agentUrl = `${base ?? beUrl("").replace(/\/$/, "")}/api/agents/${agentId}`
    const history = createHttpHistoryPipe(`${agentUrl}/history`, {
      _fetch: rest._fetch,
      headers: wireHeaders,
    })
    view = new RemoteSessionView(
      agentId,
      createWsSessionPipe(url, { _WebSocket: rest._WebSocket, history }),
      {
        ...rest,
        baseUrl: base,
        connectionId,
        targetBackendBaseUrl: url.startsWith("ws://ssr-stub/")
          ? undefined
          : targetBackendBase(url.slice(0, -path.length)),
      },
    )
  } else {
    view = createRemoteSessionView(agentId, base ?? beUrl("").replace(/\/$/, ""), rest)
  }
  await view.connect()
  return view
}
