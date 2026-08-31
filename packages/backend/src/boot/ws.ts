/**
 * boot/ws.ts — WebSocket handlers + upgrade router (C3 pure extraction).
 */

import type { ServerMessage } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { ServerType } from "@hono/node-server"
import type { Hono } from "hono"
import { WebSocket, WebSocketServer } from "ws"
import { createAgentWsHandler } from "../delivery/ws-agent.js"
import { createEchoWsHandler } from "../delivery/ws-echo.js"
import { safeUrlPathname } from "../delivery/url-safe.js"
import { registerConnectionRoute } from "../session-host/http/index.js"
import type { BootDeps } from "./deps.js"

const log = createLogger("backend.server")
const procLog = createLogger("backend.process")

export type WsStack = {
  echoWss: WebSocketServer
  agentWss: WebSocketServer
  broadcastConfigChanged: () => void
  wireRoutes: (app: Hono, deps: BootDeps) => void
  attachUpgradeHandler: (httpServer: ServerType) => void
}

/** Creates WS servers + broadcast fn (safe to pass to buildApp before routes are wired). */
export function createWsStack(): WsStack {
  const echoWss = new WebSocketServer({ noServer: true })
  const agentWss = new WebSocketServer({ noServer: true })

  echoWss.on("error", (err) => procLog.warn({ src: "echoWss", err }, "wss error"))
  agentWss.on("error", (err) => procLog.warn({ src: "agentWss", err }, "wss error"))

  function broadcastConfigChanged(): void {
    const payload: ServerMessage = { type: "config_changed", timestamp: Date.now() }
    const msg = JSON.stringify(payload)
    for (const client of echoWss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
  }

  function wireRoutes(app: Hono, deps: BootDeps): void {
    const { orchestrator, connectionRegistry, agentSessionRegistry, evictionController } = deps

    const echoHandler = createEchoWsHandler()
    const agentWs = createAgentWsHandler({
      orchestrator,
      connectionRegistry,
      sessionHostRegistry: agentSessionRegistry,
      evictionController,
    })
    const onAgentConnect = agentWs.onConnect
    registerConnectionRoute(app, connectionRegistry, {
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

      socket.destroy()
    })
  }

  return { echoWss, agentWss, broadcastConfigChanged, wireRoutes, attachUpgradeHandler }
}
