import { WS_SESSION_PATH_PREFIX } from "@drive-coding/core/session"
import { beUrl, beWsUrl } from "$lib/util/be-url.js"
import { RemoteSessionView, type RemoteViewOptions } from "./remote-session-view.js"
import type { SessionTransport } from "./session-transport.js"
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
  const pipe = {
    frames: createSseFramePipe(`${agentUrl}/events`, wireOptions),
    rpc: createHttpRpcPipe(agentUrl, wireOptions),
    close() {}, // FrameReader owns and aborts the SSE request.
  }
  return new RemoteSessionView(agentId, pipe, { ...opts, baseUrl, connectionId })
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
    const query = new URLSearchParams({ connectionId })
    const path = `${WS_SESSION_PATH_PREFIX}${encodeURIComponent(agentId)}?${query}`
    const url = base ? base.replace(/^http/, "ws") + path : beWsUrl(path)
    view = new RemoteSessionView(
      agentId,
      createWsSessionPipe(url, { _WebSocket: rest._WebSocket }),
      { ...rest, baseUrl: base, connectionId },
    )
  } else {
    view = createRemoteSessionView(agentId, base ?? beUrl("").replace(/\/$/, ""), rest)
  }
  await view.connect()
  return view
}
