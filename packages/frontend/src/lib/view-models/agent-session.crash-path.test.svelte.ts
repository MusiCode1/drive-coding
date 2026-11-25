import {
  closeCodeForStatus,
  createInitialSessionState,
  encodeWsFrame,
  snapshotFrame,
} from "@drive-coding/core/session"
import { afterEach, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "$lib/session/__contract__/fake-session-socket"
import { historyTailResponse } from "./__fixtures__/meta-history-fetch"
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
  const openState = createInitialSessionState({ sessionId: "session-1" })
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/history")) {
      return Response.json(historyTailResponse(openState, { history: "omit" }), { status: 200 })
    }
    return Response.json({ agent: { cwd: "/project", status: "crashed", crashReason } })
  })
  vi.stubGlobal("fetch", fetchImpl)
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
    encodeWsFrame(snapshotFrame(openState, undefined, "meta")),
  )
  await attaching
  expect(session.status).toBe("connected")

  // The backend closes the viewer stream on crash and rejects the next open with 404.
  initialSocket.close(1000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(sockets.instances).toHaveLength(2)
  sockets.latest().close(closeCodeForStatus(404))
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => expect(session.error).toBe(crashReason), { timeout: 5000 })

  expect(session.error).toBe(crashReason)
  expect(fetchImpl).toHaveBeenCalled()
  expect(fetchImpl.mock.calls.some(([u]) => String(u).includes("/api/agents/agent-crash"))).toBe(
    true,
  )
})
