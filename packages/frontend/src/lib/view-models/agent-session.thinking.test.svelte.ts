import {
  createInitialSessionState,
  decodeWsClientMessage,
  encodeWsFrame,
  encodeWsServerResponse,
  RPC_METHODS,
  snapshotFrame,
} from "@drive-coding/core/session"
import { afterEach, expect, it, vi } from "vitest"
import { fakeSessionSockets } from "$lib/session/__contract__/fake-session-socket"
import { AgentSession } from "./agent-session.svelte"

vi.mock("$lib/adapters/agents-api", () => ({
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  releaseConnection: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => vi.unstubAllGlobals())

it("sends validated thinking tokens, including null, through the WebSocket session RPC", async () => {
  const sockets = fakeSessionSockets()
  vi.stubGlobal("location", { protocol: "http:", host: "localhost", search: "" })
  vi.stubGlobal("WebSocket", sockets.WebSocket)
  const session = new AgentSession()
  const attaching = session.attachRemoteToLiveAgent({
    agentId: "agent",
    cwd: "/project",
    cliKind: "codex",
    transport: "ws",
  })
  const socket = sockets.latest()
  socket.connect()
  socket.receive(encodeWsFrame(snapshotFrame(createInitialSessionState({ sessionId: "session" }))))
  await attaching

  const requests: unknown[] = []
  const send = socket.send.bind(socket)
  vi.spyOn(socket, "send").mockImplementation((data) => {
    send(data)
    const message = decodeWsClientMessage(data)
    if (message?.kind !== "request") return
    requests.push({ method: message.request.method, params: message.request.params })
    socket.receive(encodeWsServerResponse(message.request.id, { status: 202, body: {} }))
  })

  try {
    await session.setThinkingTokens(1024)
    await session.setThinkingTokens(null)
    await expect(session.setThinkingTokens("invalid" as unknown as number)).rejects.toThrow()
    expect(requests).toEqual(
      [1024, null].map((n) => ({
        method: "_drive/rpc",
        params: {
          method: RPC_METHODS.extMethod,
          params: {
            sessionId: "session",
            method: "_drive/setThinkingTokens",
            params: { sessionId: "session", n },
          },
        },
      })),
    )
  } finally {
    session.detach()
  }
})

it("ignores thinking token changes before connecting", async () => {
  const session = new AgentSession()
  await expect(session.setThinkingTokens("invalid" as unknown as number)).resolves.toBeUndefined()
})
