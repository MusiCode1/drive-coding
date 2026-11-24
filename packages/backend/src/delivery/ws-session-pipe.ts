import { randomUUID } from "node:crypto"
import type { IncomingMessage } from "node:http"
import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import {
  type ChannelResponse,
  closeCodeForStatus,
  decodeWsClientMessage,
  encodeWsControl,
  encodeWsFrame,
  encodeWsServerResponse,
  WS_RPC_METHOD,
  WS_SESSION_PATH_PREFIX,
  type WsClientRequest,
} from "@drive-coding/core/session"
import type { WebSocket } from "ws"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { CallerContext } from "../session-host/channel/caller-context.js"
import { dispatchReply, replyScopeDenied } from "../session-host/channel/reply-dispatch.js"
import { dispatchRpcBody } from "../session-host/channel/rpc-dispatch.js"
import { openViewer, type ViewerEnd } from "../session-host/channel/viewer-stream.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"

const log = createLogger("backend.ws.session")

const closeCodeByEnd: Record<ViewerEnd, number> = {
  ended: 1000,
  cancelled: 1000,
  failed: closeCodeForStatus(500),
}

export function createSessionWsHandler({
  agentSessionRegistry,
  connectionRegistry,
  agentRegistry,
  _staleMs = 60_000,
  _sweepMs = 20_000,
}: {
  agentSessionRegistry: AgentSessionRegistry
  connectionRegistry: ConnectionRegistry
  agentRegistry: AgentRegistry
  _staleMs?: number
  _sweepMs?: number
}): { onConnect(ws: WebSocket, req: IncomingMessage): Promise<void>; stop(): void } {
  const liveSockets = new Map<WebSocket, number>()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [ws, lastPingAt] of liveSockets) {
      if (now - lastPingAt > _staleMs) ws.terminate()
    }
  }, _sweepMs)
  sweep.unref()

  const dispatchDeps = { registry: agentRegistry, sessionRegistry: agentSessionRegistry }

  async function onConnect(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? "", "http://localhost")
    const agentId = url.pathname.slice(WS_SESSION_PATH_PREFIX.length)
    if (!url.pathname.startsWith(WS_SESSION_PATH_PREFIX) || !agentId || agentId.includes("/")) {
      ws.close(closeCodeForStatus(404))
      return
    }

    const connectionId = url.searchParams.get("connectionId") ?? randomUUID()
    const epochParam = url.searchParams.get("epoch")
    const epoch = epochParam?.trim() ? Number(epochParam) : NaN
    const caller: CallerContext = {
      header(name) {
        const value = req.headers[name.toLowerCase()]
        return Array.isArray(value) ? value[0] : value
      },
    }
    const childLog = log.child({ agentId, connectionId })

    let cancelViewer: (() => void) | undefined
    let cancelled = false
    let reportedBadMessage = false
    liveSockets.set(ws, Date.now())

    function cancel() {
      cancelled = true
      liveSockets.delete(ws)
      cancelViewer?.()
    }

    function close(code: number) {
      if (ws.readyState === ws.OPEN) ws.close(code)
    }

    async function send(message: string): Promise<void> {
      try {
        await new Promise<void>((resolve, reject) => {
          if (ws.readyState !== ws.OPEN) {
            reject(new Error("WebSocket is closed"))
            return
          }
          ws.send(message, (err) => (err ? reject(err) : resolve()))
        })
      } catch (err) {
        cancel()
        close(1000)
        throw err
      }
    }

    async function dispatch(request: WsClientRequest): Promise<ChannelResponse> {
      try {
        if (request.method === WS_RPC_METHOD) {
          return await dispatchRpcBody(dispatchDeps, agentId, request.params, caller)
        }
        const denied = await replyScopeDenied(dispatchDeps, agentId, caller)
        return (
          denied ??
          (await dispatchReply(agentSessionRegistry, agentId, async () => request.params, caller))
        )
      } catch (err) {
        childLog.error({ err }, "WebSocket request dispatch failed")
        return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } }
      }
    }

    // Requests and socket lifecycle events may arrive while the host is opening.
    ws.on("close", cancel)
    ws.on("error", (err) => {
      childLog.warn({ err }, "session WebSocket error")
      cancel()
      close(1000)
    })
    ws.on("message", (data) => {
      if (cancelled) return
      const message = decodeWsClientMessage(data.toString())
      switch (message?.kind) {
        case "request":
          void dispatch(message.request)
            .then((result) => send(encodeWsServerResponse(message.request.id, result)))
            .catch(() => {
              cancel()
              close(1000)
            })
          break
        case "ping":
          liveSockets.set(ws, Date.now())
          void send(encodeWsControl("$/pong")).catch(() => {})
          break
        case "detach":
          cancel()
          close(1000)
          break
        default:
          if (reportedBadMessage) break
          reportedBadMessage = true
          childLog.warn({}, "ignoring invalid session WebSocket message")
      }
    })

    let closeCode = closeCodeForStatus(500)
    try {
      const viewer = await openViewer(
        { registry: agentSessionRegistry, connectionRegistry },
        {
          agentId,
          connectionId,
          clientEpoch: Number.isFinite(epoch) ? epoch : undefined,
          via: "ws",
        },
      )
      if (viewer.ok) {
        cancelViewer = viewer.cancel
        if (cancelled) cancelViewer()
        const end = await viewer.run({ write: (frame) => send(encodeWsFrame(frame)) })
        closeCode = closeCodeByEnd[end]
      } else if (!cancelled) {
        const { status, body } = viewer.response
        closeCode = closeCodeForStatus(status)
        await send(encodeWsFrame({ event: "error", data: JSON.stringify(body) }))
      }
    } catch (err) {
      childLog.error({ err }, "session WebSocket failed")
    } finally {
      cancel()
      close(closeCode)
    }
  }

  return { onConnect, stop: () => clearInterval(sweep) }
}
