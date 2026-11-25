import {
  closeCodeForStatus,
  createInitialSessionState,
  encodeWsFrame,
  snapshotFrame,
} from "@drive-coding/core/session"
import { afterEach, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "$lib/session/__contract__/fake-session-socket"
import { AgentSession } from "./agent-session.svelte"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("shows the provider crash reason after a terminal session WebSocket reconnect", async () => {
  const sockets = fakeSessionSockets()
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", sockets.WebSocket)
  vi.stubGlobal("location", { protocol: "http:", host: "localhost" })

  const crashReason = "ENOENT: provider binary not found"
  const fetchAgent = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname } = new URL(String(input), "http://localhost")
    if (pathname.endsWith("/api/agents/agent-crash/history")) {
      return Response.json({ version: 0, updates: [] })
    }
    if (pathname.endsWith("/api/agents/agent-crash")) {
      return Response.json({ agent: { cwd: "/project", status: "crashed", crashReason } })
    }
    throw new Error(`Unexpected agent request: ${pathname}`)
  })
  vi.stubGlobal("fetch", fetchAgent)
  const session = new AgentSession()
  const attaching = session.attachRemoteToLiveAgent({
    agentId: "agent-crash",
    cwd: "/project",
    cliKind: "codex",
    transport: "ws",
  })
  const initialSocket = sockets.latest()
  initialSocket.connect()
  initialSocket.receive(
    encodeWsFrame(snapshotFrame(createInitialSessionState({ sessionId: "session-1" }))),
  )
  await attaching
  expect(session.status).toBe("connected")

  // The backend closes the viewer stream on crash and rejects the next open with 404.
  initialSocket.close(1000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(sockets.instances).toHaveLength(2)
  sockets.latest().close(closeCodeForStatus(404))
  await vi.advanceTimersByTimeAsync(10)
  expect(session.error).toBe(crashReason)

  const metadataCalls = fetchAgent.mock.calls.filter(([input]) =>
    new URL(String(input), "http://localhost").pathname.endsWith("/api/agents/agent-crash"),
  )
  expect(metadataCalls).toHaveLength(1)
})
