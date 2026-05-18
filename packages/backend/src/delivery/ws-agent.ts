/**
 * ws-agent.ts — WebSocket bytes pipe for /ws/agent/:id
 *
 * Phase 1: Converted from Bun.serve WebSocketHandler to ws library API.
 * Phase 3: Will replace bridge WS proxy with direct in-process pipe.
 *
 * Acts as a bidirectional transparent proxy between the FE WebSocket
 * and the stdio-to-ws bridge process on loopback.
 *
 * The BE does NOT parse, validate, or enrich the frames —
 * raw ACP JSON-RPC bytes flow through as-is.
 *
 * Edge cases:
 *   - Agent not found → close(1008, "agent not found")
 *   - MED-8: second tab for same agentId → close(1008, "agent in use by another tab")
 *   - FE sends before bridge ready → buffered in pendingFromFe, flushed at bridge open
 *   - bridgeWs close → feWs.close(1011, "bridge closed")
 *   - bridgeWs error → feWs.close(1011, "bridge error")
 *   - feWs close → cleanup: activeFeWs.delete(agentId), bridgeWs.close()
 */

import { createLogger } from "@drive-coding/core/log"
import { WebSocket } from "ws"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"

const log = createLogger("backend.ws.agent")

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentWsData = {
  kind: "agent"
  agentId: string
  bridgeWs?: WebSocket
  pendingFromFe: Array<string | Buffer>
  bridgeOpen: boolean
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createAgentWsHandler(deps: { orchestrator: AgentOrchestrator }): {
  websocket: {
    open?: (ws: {
      data: AgentWsData
      send: (d: string | Buffer) => void
      close: (code: number, reason: string) => void
    }) => Promise<void>
    message?: (
      ws: {
        data: AgentWsData
        send: (d: string | Buffer) => void
        close: (code: number, reason: string) => void
      },
      raw: string | Buffer,
    ) => void
    close?: (
      ws: {
        data: AgentWsData
        send: (d: string | Buffer) => void
        close: (code: number, reason: string) => void
      },
      code: number,
      reason: string,
    ) => void
  }
} {
  // MED-8: one active FE WS per agentId — prevents ACP state collision on second tab
  const activeFeWs = new Map<
    string,
    {
      data: AgentWsData
      send: (d: string | Buffer) => void
      close: (code: number, reason: string) => void
    }
  >()

  const websocket = {
    async open(feWs: {
      data: AgentWsData
      send: (d: string | Buffer) => void
      close: (code: number, reason: string) => void
    }) {
      const agentId = feWs.data.agentId
      log.child({ agentId }).info({}, "WS connect")

      // MED-8: reject second tab connecting to same agent
      if (activeFeWs.has(agentId)) {
        log.child({ agentId }).warn({}, "second tab rejected")
        feWs.close(1008, "agent in use by another tab")
        return
      }

      // Look up bridge port from orchestrator
      const port = deps.orchestrator.getBridgePort(agentId)
      if (!port) {
        log.child({ agentId }).warn({}, "agent not found")
        feWs.close(1008, "agent not found")
        return
      }

      activeFeWs.set(agentId, feWs)

      // Connect to stdio-to-ws bridge on loopback
      const bridgeWs = new WebSocket(`ws://127.0.0.1:${port}/`)
      feWs.data.bridgeWs = bridgeWs
      feWs.data.pendingFromFe = []
      feWs.data.bridgeOpen = false

      bridgeWs.on("open", () => {
        feWs.data.bridgeOpen = true
        // Flush buffered FE messages
        for (const msg of feWs.data.pendingFromFe) {
          try {
            bridgeWs.send(msg)
          } catch {
            // bridge closing
          }
        }
        feWs.data.pendingFromFe = []
      })

      bridgeWs.on("message", (data) => {
        // Forward bridge frame as-is to FE.
        try {
          feWs.send(data as string | Buffer)
        } catch {
          // feWs closing
        }
      })

      bridgeWs.on("close", () => {
        log.child({ agentId }).info({}, "bridge closed — closing feWs")
        try {
          feWs.close(1011, "bridge closed")
        } catch {
          // already closed
        }
      })

      bridgeWs.on("error", (err) => {
        log.child({ agentId }).error({ err }, "bridge error — closing feWs")
        try {
          feWs.close(1011, "bridge error")
        } catch {
          // already closed
        }
      })
    },

    message(
      feWs: {
        data: AgentWsData
        send: (d: string | Buffer) => void
        close: (code: number, reason: string) => void
      },
      raw: string | Buffer,
    ) {
      // Forward FE message to bridge, or buffer if bridge not yet open
      if (feWs.data.bridgeOpen && feWs.data.bridgeWs) {
        try {
          feWs.data.bridgeWs.send(raw as string | Buffer)
        } catch {
          // bridge closing
        }
      } else {
        feWs.data.pendingFromFe.push(raw as string | Buffer)
      }
    },

    close(feWs: {
      data: AgentWsData
      send: (d: string | Buffer) => void
      close: (code: number, reason: string) => void
    }) {
      const agentId = feWs.data.agentId
      log.child({ agentId }).info({}, "WS disconnect — cleanup")
      activeFeWs.delete(agentId)
      try {
        feWs.data.bridgeWs?.close()
      } catch {
        // already closed
      }
    },
  }

  return { websocket }
}
