import type { AcpClient } from "@drive-coding/provider/client"
import { createAttachedAcpClient } from "@drive-coding/provider/client"
import { notifySessionAttached } from "$lib/adapters/agents-api"
import type { WsConnection, WsConnectionDeps } from "./ws-connection"
import type { WsReconnectAttempt } from "./ws-reconnect-attempt"
import type { ReconnectContext, WsReconnectDeps } from "./ws-reconnect-controller"

export type WarmResult = "connected" | "cold-eligible" | "terminal"

/** Warm handshake and replay use the single transport owned by WsConnection. */
export async function runWarmReconnect(
  owner: WsConnection,
  deps: WsConnectionDeps,
  reconnect: WsReconnectDeps,
  attemptState: WsReconnectAttempt,
  agentId: string,
  context: ReconnectContext,
  generation: number,
  isCurrent: () => boolean,
): Promise<WarmResult> {
  reconnect.prepareWarm(agentId)
  reconnect.setStatus("connecting")
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (!isCurrent()) return "terminal"
    const transport = owner.beginWarmTransport(deps.url(agentId))
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      transport.onClose((code, reason) => resolve({ code, reason }))
    })
    const outcome = await attemptState.awaitCurrent(
      Promise.race([
        transport
          .waitForOpen()
          .then(() => null)
          .catch(() => ({ code: 0, reason: "" })),
        closed,
      ]),
      generation,
      isCurrent,
    )
    if (outcome.kind === "cancelled" || !isCurrent()) {
      owner.discardTransport(transport)
      return "terminal"
    }
    const opened = outcome.value
    if (opened) {
      owner.discardTransport(transport)
      if (
        opened.code === 4409 ||
        (opened.code === 1008 && opened.reason === "session-host-active")
      ) {
        reconnect.setTerminal(opened.code === 4409 ? "takeover" : "host-active")
        return "terminal"
      }
      if (opened.code === 1008 && attempt < 3) {
        await attemptState.wait(250)
        continue
      }
      return "cold-eligible"
    }
    transport.onClose((code, reason) => {
      if (owner.transport === transport && code !== 1000 && code !== 1001)
        void owner.onUnexpectedClose(code, reason)
    })
    try {
      const view = deps.bindLocalView()
      const client = createAttachedAcpClient(transport, deps.callbacks(view), {
        capabilities: {} as AcpClient["capabilities"],
      })
      reconnect.setAttachedClient(client)
      deps.adoptLocalView(client, context.sessionId)
      reconnect.startReplay()
      try {
        const meta = deps.sessionMeta()
        const replay = await attemptState.awaitCurrent(
          client.loadSession({
            sessionId: context.sessionId,
            cwd: context.cwd,
            mcpServers: [],
            ...(meta && { _meta: meta }),
          }),
          generation,
          isCurrent,
        )
        if (replay.kind === "cancelled" || !isCurrent()) {
          owner.discardTransport(transport)
          return "terminal"
        }
        deps.captureSessionConfig(replay.value)
      } finally {
        reconnect.finishReplay()
      }
      const notified = await attemptState.awaitCurrent(
        notifySessionAttached(agentId, context.sessionId, { replace: true }).catch(() => {}),
        generation,
        isCurrent,
      )
      if (notified.kind === "cancelled" || !isCurrent()) {
        owner.discardTransport(transport)
        return "terminal"
      }
      reconnect.setStatus("connected")
      owner.finishWarmTransport(transport)
      return "connected"
    } catch {
      reconnect.disposeFailedWarm()
      owner.discardTransport(transport)
      return "cold-eligible"
    }
  }
  return "cold-eligible"
}
