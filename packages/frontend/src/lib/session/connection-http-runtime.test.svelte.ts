import { once } from "node:events"
import { createServer, type Server } from "node:http"
import { createInitialSessionState } from "@drive-coding/core/session"
import { toWireText } from "@drive-coding/core/session/testing"
import { afterEach, expect, it, vi } from "vitest"

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(() => {
    throw new Error("HTTP entry constructed a WebSocket")
  }),
}))

import { AgentSession } from "$lib/view-models/agent-session.svelte"

let server: Server | undefined
afterEach(async () => {
  vi.unstubAllGlobals()
  server?.closeAllConnections()
  if (server?.listening) {
    server.close()
    await once(server, "close")
  }
  server = undefined
})

it("opens a new agent over real HTTP/SSE and adopts the snapshot session", async () => {
  const paths: string[] = []
  const snapshot = createInitialSessionState({ sessionId: "http-probe-session" })
  const wire = toWireText([{ event: "snapshot", data: JSON.stringify(snapshot) }])
  server = createServer(async (req, res) => {
    paths.push(req.url ?? "")
    if (req.method === "POST" && req.url === "/api/agents") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ agentId: "http-probe-agent", status: "spawning" }))
    } else if (req.method === "GET" && req.url?.includes("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.write(wire)
    } else {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing HTTP address")
  vi.stubGlobal("location", {
    origin: `http://127.0.0.1:${address.port}`,
    protocol: "http:",
    host: `127.0.0.1:${address.port}`,
    search: "",
  })

  const session = new AgentSession()
  await session.attachRemote({ cwd: "/tmp", cliKind: "claude" })
  expect(session.status).toBe("connected")
  expect(session.agentId).toBe("http-probe-agent")
  expect(session.sessionId).toBe("http-probe-session")
  expect(paths).toContain("/api/agents")
  expect(paths.some((path) => path.includes("/api/agents/http-probe-agent/events"))).toBe(true)
  session.detach()
})
