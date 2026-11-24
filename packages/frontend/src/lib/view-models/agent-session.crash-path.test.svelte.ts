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
  const fetchMetadata = vi
    .fn()
    .mockResolvedValue(
      Response.json({ agent: { cwd: "/project", status: "crashed", crashReason } }),
    )
  vi.stubGlobal("fetch", fetchMetadata)
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
  await vi.advanceTimersByTimeAsync(0)

  expect(session.error).toBe(crashReason)
  expect(fetchMetadata).toHaveBeenCalledOnce()
})
