/**
 * boot/ws.ts — WebSocket handlers + upgrade router (C3 pure extraction).
 */

import type { ServerMessage } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { WS_SESSION_PATH_PREFIX } from "@drive-coding/core/session"
import type { ServerType } from "@hono/node-server"
import type { Hono } from "hono"
import { WebSocket, WebSocketServer } from "ws"
import { safeUrlPathname } from "../delivery/url-safe.js"
import { createAgentWsHandler } from "../delivery/ws-agent.js"
import { createEchoWsHandler } from "../delivery/ws-echo.js"
import { createSessionWsHandler } from "../delivery/ws-session-pipe.js"
import { SCOPE_DENIED_BODY, whenScopedWriteAllowed } from "../scope-write.js"
import { registerConnectionRoute } from "../session-host/http/index.js"
import type { PatchesBroadcaster } from "../session-host/patches-broadcaster.js"
import type { BootDeps } from "./deps.js"

const log = createLogger("backend.server")
const procLog = createLogger("backend.process")

export type WsStack = {
  echoWss: WebSocketServer
  agentWss: WebSocketServer
  sessionWss: WebSocketServer
  stop: () => void
  broadcastConfigChanged: (changed?: string[]) => void
  wireRoutes: (app: Hono, deps: BootDeps) => void
  attachUpgradeHandler: (httpServer: ServerType) => void
}

/** Creates WS servers + broadcast fn (safe to pass to buildApp before routes are wired). */
export function createWsStack(): WsStack {
  const echoWss = new WebSocketServer({ noServer: true })
  const agentWss = new WebSocketServer({ noServer: true })
  const sessionWss = new WebSocketServer({ noServer: true })
  let sessionHandler: ReturnType<typeof createSessionWsHandler> | undefined

  echoWss.on("error", (err) => procLog.warn({ src: "echoWss", err }, "wss error"))
  agentWss.on("error", (err) => procLog.warn({ src: "agentWss", err }, "wss error"))
  sessionWss.on("error", (err) => procLog.warn({ src: "sessionWss", err }, "wss error"))

  function broadcastConfigChanged(changed: string[] = []): void {
    const payload: ServerMessage = { type: "config_changed", timestamp: Date.now(), changed }
    const msg = JSON.stringify(payload)
    for (const client of echoWss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
  }

  function wireRoutes(app: Hono, deps: BootDeps): void {
    const { orchestrator, connectionRegistry, agentSessionRegistry, evictionController } = deps

    const sessionWs = createSessionWsHandler({
      agentSessionRegistry,
      connectionRegistry,
      agentRegistry: deps.registry,
    })
    sessionHandler = sessionWs
    sessionWss.on("connection", (ws, req) => {
      void sessionWs.onConnect(ws, req).catch((err) => {
        ws.close(4500)
        procLog.error({ err }, "session WebSocket connection failed")
      })
    })

    const echoHandler = createEchoWsHandler()
    const agentWs = createAgentWsHandler({
      orchestrator,
      connectionRegistry,
      sessionHostRegistry: agentSessionRegistry,
      evictionController,
    })
    const onAgentConnect = agentWs.onConnect
    app.use("/api/agents/:id/connection", (c, next) => {
      if (c.req.method !== "DELETE") return next()
      return whenScopedWriteAllowed((name) => c.req.header(name), {
        targetId: c.req.param("id"),
        verb: "detach",
        registry: deps.registry,
        sessionRegistry: agentSessionRegistry,
      }).then(async (allowed) => {
        if (allowed) return next()
        return c.json(SCOPE_DENIED_BODY, 403)
      })
    })
    registerConnectionRoute(app, connectionRegistry, {
      beforeRemoveConnection(agentId, connectionId) {
        const row = connectionRegistry
          .listViewerRows(agentId)
          .find((candidate) => candidate.connectionId === connectionId)
        if (row?.stream !== undefined) {
          agentSessionRegistry
            .getBroadcaster(agentId)
            ?.unsubscribe(row.stream as Parameters<PatchesBroadcaster["unsubscribe"]>[0])
        }
      },
      closeLiveSocket: agentWs.closeLiveSocket,
    })

    echoWss.on("connection", (ws) => {
      echoHandler(ws)
    })

    agentWss.on("connection", (ws, req) => {
      const pathname = safeUrlPathname(req.url)
      if (pathname === null) {
        ws.close()
        return
      }
      const match = pathname.match(/^\/ws\/agent\/([^/]+)$/)
      const agentId = match?.[1] ?? ""
      let connectionId: string | undefined
      try {
        connectionId =
          new URL(req.url ?? "", "http://localhost").searchParams.get("connectionId") ?? undefined
      } catch {
        connectionId = undefined
      }

      onAgentConnect(ws, agentId, connectionId).catch((err) => {
        ws.close(1011, "internal error")
        procLog.error({ err, agentId }, "onAgentConnect async error")
      })
    })
  }

  function attachUpgradeHandler(httpServer: ServerType): void {
    httpServer.on("upgrade", (req, socket, head) => {
      const pathname = safeUrlPathname(req.url)
      if (pathname === null) {
        log.warn({ url: req.url }, "upgrade: malformed request-target — destroying socket")
        socket.destroy()
        return
      }

      if (pathname === "/ws/echo") {
        echoWss.handleUpgrade(req, socket, head, (ws) => {
          echoWss.emit("connection", ws, req)
        })
        return
      }

      if (pathname.startsWith("/ws/agent/")) {
        agentWss.handleUpgrade(req, socket, head, (ws) => {
          agentWss.emit("connection", ws, req)
        })
        return
      }

      if (pathname.startsWith(WS_SESSION_PATH_PREFIX)) {
        sessionWss.handleUpgrade(req, socket, head, (ws) => {
          sessionWss.emit("connection", ws, req)
        })
        return
      }

      socket.destroy()
    })
  }

  return {
    echoWss,
    agentWss,
    sessionWss,
    stop: () => sessionHandler?.stop(),
    broadcastConfigChanged,
    wireRoutes,
    attachUpgradeHandler,
  }
}
