/**
 * ws-agent.ts — WebSocket bytes pipe for /ws/agent/:id
 *
 * Phase 3: Direct in-process pipe from feWs → child.stdin/stdout.
 * No intermediate WS bridge process needed.
 *
 * Architecture:
 *   feWs (ws.WebSocket from FE browser)
 *     ↕ readline + stdin.write
 *   child (ChildProcess spawned by bridge-manager)
 *
 * Edge cases:
 *   - Agent not found → close(1008, "agent not found")
 *   - MED-8: second tab for same agentId → close(1008, "agent in use by another tab")
 *   - child exit → feWs.close(1011, "bridge closed")
 *   - feWs close → cleanup (rl.close + detach), NO child.kill
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { createLogger } from "@drive-coding/core/log"
import type { WebSocket } from "ws"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"

const log = createLogger("backend.ws.agent")

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentWsData = {
  kind: "agent"
  agentId: string
  bridgeWs?: undefined
  pendingFromFe: Array<string | Buffer>
  bridgeOpen: boolean
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createAgentWsHandler(deps: {
  orchestrator: AgentOrchestrator
  bridgeManager: { getChild(bridgeId: string): ChildProcessWithoutNullStreams | null }
}): (ws: WebSocket, agentId: string) => void {
  // MED-8: one active FE WS per agentId — prevents ACP state collision on second tab
  const activeFeWs = new Map<string, WebSocket>()

  return function onConnect(feWs: WebSocket, agentId: string): void {
    const childLog = log.child({ agentId })

    // MED-8 guard
    if (activeFeWs.has(agentId)) {
      childLog.warn({}, "second tab rejected")
      feWs.close(1008, "agent in use by another tab")
      return
    }

    const child = deps.bridgeManager.getChild(agentId)
    if (!child) {
      childLog.warn({}, "agent not found")
      feWs.close(1008, "agent not found")
      return
    }

    activeFeWs.set(agentId, feWs)
    childLog.info({ pid: child.pid }, "WS connect → pipe attached")

    // ── pipeChild ─────────────────────────────────────────────────────────────
    // child.stdout (NDJSON lines) → feWs.send
    child.stdout.setEncoding("utf8")
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on("line", (line) => {
      if (line.length === 0) return
      try {
        feWs.send(line)
      } catch {
        // feWs closing
      }
    })

    // feWs message → child.stdin (add newline if missing)
    feWs.on("message", (data) => {
      try {
        const text = data.toString()
        const line = text.endsWith("\n") ? text : `${text}\n`
        child.stdin.write(line)
      } catch (err) {
        childLog.warn({ err }, "stdin write failed")
      }
    })

    // child exit → close feWs
    const onChildExit = (code: number | null) => {
      childLog.info({ code }, "child exited — closing feWs")
      try {
        feWs.close(1011, "bridge closed")
      } catch {
        // already closed
      }
    }
    child.once("exit", onChildExit)

    // feWs close → cleanup, but do NOT kill child
    feWs.on("close", () => {
      childLog.info({}, "WS disconnect — detaching pipe")
      activeFeWs.delete(agentId)
      rl.close()
      child.off("exit", onChildExit)
      // Important: do NOT call child.kill() — child survives FE disconnect
    })
  }
}
