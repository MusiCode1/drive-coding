import {
  decodeWsClientMessage,
  decodeWsServerMessage,
  type SessionState,
} from "@drive-coding/core/session"
import { describe, expect, it, vi } from "vitest"
import { createRemoteView } from "../create-session-view"

const baseUrl = process.env.DC_LIVE_BE
const agentId = process.env.DC_LIVE_AGENT

function terminalOutput(state: SessionState, marker: string) {
  for (const message of state.messages) {
    if (message.role !== "tool") continue
    const output = message.toolCall.output
    if (output?.text?.includes(marker)) return output
  }
}

describe.skipIf(!baseUrl)("live SSE and WS session views", () => {
  it("shares terminal output across simultaneous viewers and reconnects WS", async () => {
    if (!baseUrl || !agentId) throw new Error("Set DC_LIVE_BE and DC_LIVE_AGENT")
    const sockets: ObservedSocket[] = []
    class ObservedSocket extends WebSocket {
      readonly pings: number[] = []
      pongs = 0
      snapshotSeen = false

      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        sockets.push(this)
        this.addEventListener("message", ({ data }) => {
          if (typeof data !== "string") return
          const message = decodeWsServerMessage(data)
          if (message?.kind === "pong") this.pongs++
          if (message?.kind === "frame" && message.frame.event === "snapshot") {
            this.snapshotSeen = true
          }
        })
      }

      override send(data: Parameters<WebSocket["send"]>[0]) {
        if (typeof data === "string" && decodeWsClientMessage(data)?.kind === "ping") {
          this.pings.push(performance.now())
        }
        super.send(data)
      }
    }

    const sse = await createRemoteView({ agentId, baseUrl, transport: "http" })
    try {
      const ws = await createRemoteView({
        agentId,
        baseUrl,
        transport: "ws",
        _WebSocket: ObservedSocket,
      })
      try {
        expect(sse.state.sessionId).toBeTruthy()
        expect(ws.state.sessionId).toBe(sse.state.sessionId)

        const marker = `dc-ws-probe-${crypto.randomUUID()}`
        const firstMarker = `${marker}-before`
        const secondMarker = `${marker}-after`

        async function verifyOutput(expectedMarker: string, exitCode: number) {
          await vi.waitFor(
            () => {
              const httpOutput = terminalOutput(sse.state, expectedMarker)
              expect(httpOutput).toMatchObject({ exitCode })
              expect(terminalOutput(ws.state, expectedMarker)).toEqual(httpOutput)
              expect(sse.state.turnState).toBe("idle")
            },
            { timeout: 55_000, interval: 100 },
          )
        }

        await ws.prompt(
          `Run this exact shell command once using the terminal tool, then stop: printf '${firstMarker}\\n'; exit 7`,
        )
        await verifyOutput(firstMarker, 7)

        const firstSocket = sockets[0]
        if (!firstSocket) throw new Error("Initial WS socket missing")
        await vi.waitFor(() => expect(firstSocket.pongs).toBeGreaterThanOrEqual(2), {
          timeout: 20_000,
          interval: 100,
        })
        const [firstPing, secondPing] = firstSocket.pings
        if (firstPing === undefined || secondPing === undefined) throw new Error("Missing WS pings")
        expect(secondPing - firstPing).toBeLessThan(60_000)

        firstSocket.close(1000)
        await vi.waitFor(
          () => {
            expect(firstSocket.readyState).toBe(WebSocket.CLOSED)
            expect(sockets).toHaveLength(2)
            expect(sockets[1]?.snapshotSeen).toBe(true)
            expect(sockets[1]?.pongs).toBeGreaterThanOrEqual(1)
          },
          { timeout: 10_000, interval: 100 },
        )
        expect(ws.state.sessionId).toBe(sse.state.sessionId)
        expect(terminalOutput(ws.state, firstMarker)).toEqual(
          terminalOutput(sse.state, firstMarker),
        )

        await sse.prompt(
          `Run this exact shell command once using the terminal tool, then stop: printf '${secondMarker}\\n'; exit 0`,
        )
        await verifyOutput(secondMarker, 0)
      } finally {
        await ws.close()
      }
    } finally {
      await sse.close()
    }
  }, 140_000)
})
