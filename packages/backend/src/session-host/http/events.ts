import { randomUUID } from "node:crypto"
import { serializeFrame } from "@drive-coding/core/session"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import { openViewer } from "../channel/viewer-stream.js"
import type { AgentSessionRegistry } from "../registry.js"
import { CONNECTION_ID_HEADER, readConnectionId } from "./connection-id.js"

export type RegisterEventsRouteOptions = {
  /** @internal For testing — override the keepalive timer's scheduler. */
  _setInterval?: typeof setInterval
  /** @internal For testing — override the keepalive timer's cancel. */
  _clearInterval?: typeof clearInterval
}

/** GET /api/agents/:id/events */
export function registerEventsRoute(
  app: Hono,
  registry: AgentSessionRegistry,
  connectionRegistry: ConnectionRegistry,
  opts: RegisterEventsRouteOptions = {},
): void {
  const timers = {
    setInterval(fn: () => void, ms: number) {
      return (opts._setInterval ?? setInterval)(fn, ms)
    },
    clearInterval(id: unknown) {
      ;(opts._clearInterval ?? clearInterval)(id as ReturnType<typeof setInterval>)
    },
  }

  app.get("/api/agents/:id/events", async (c) => {
    const agentId = c.req.param("id")
    const epoch = c.req.query("epoch")
    const connectionId = readConnectionId(c) ?? randomUUID()
    const viewer = await openViewer(
      { registry, connectionRegistry, timers },
      {
        agentId,
        connectionId,
        via: "http",
        clientEpoch: epoch === undefined ? undefined : Number(epoch),
      },
    )
    if (!viewer.ok) {
      const { body, status } = viewer.response
      return c.json(body, status as ContentfulStatusCode)
    }

    c.header("Content-Type", "text/event-stream")
    c.header("Cache-Control", "no-cache")
    c.header("Connection", "keep-alive")
    c.header(CONNECTION_ID_HEADER, connectionId)
    return stream(c, async (s) => {
      s.onAbort(viewer.cancel)
      await viewer.run({
        async write(frame) {
          await s.write(serializeFrame(frame))
        },
      })
    })
  })
}
