/**
 * ws-agent.ts — צינור בתי WebSocket עבור /ws/agent/:id (CUT-3b-ii rewire)
 *
 * Phase 3: צינור ישיר in-process מ-feWs ל-child.stdin/stdout.
 * אין צורך בתהליך WS bridge מתווך.
 *
 * ארכיטקטורה:
 *   feWs (ws.WebSocket מדפדפן ה-FE)
 *     ↕ conn.wire.onLine + conn.wire.write
 *   ProviderConnection (connectSpawn — in-process pipe)
 *
 * CUT-3b-ii — שינויים מ-bridge-manager:
 *   - bridgeManager.getChild → connectionRegistry.get(agentId) (presence check)
 *   - markAttached/markDetached → connectionRegistry
 *   - onLine → conn.wire.onLine
 *   - writeStdin → conn.wire.write
 *   - wire-observability: conn.onFrame נרשם פעם אחת ב-connect (registry level) —
 *     לא כאן. ⚠️ לא מוסיפים decode כאן (מניעת כפל).
 *   - child.once("exit") → conn.onCrash (close feWs כש-child מת)
 *
 * מקרי קצה:
 *   - סוכן לא נמצא → סוגר close(1008, "agent not found")
 *   - MED-8: טאב שני לאותו agentId → סוגר close(1008, "agent in use by another tab")
 *   - crash → סוגר feWs.close(1011, "bridge closed")
 *   - סגירת feWs → ניקוי (unsub + detach), לא להרוג את ה-child (conn.close לא נקרא)
 */

import { createLogger } from "@drive-coding/core/log"
import type { WebSocket } from "ws"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"

const log = createLogger("backend.ws.agent")

// ─── סוגים ────────────────────────────────────────────────────────────────────

export type AgentWsData = {
  kind: "agent"
  agentId: string
  bridgeWs?: undefined
  pendingFromFe: Array<string | Buffer>
  bridgeOpen: boolean
}

// ─── פקטורית טיפולן ──────────────────────────────────────────────────────────

export function createAgentWsHandler(deps: {
  orchestrator: AgentOrchestrator
  connectionRegistry: ConnectionRegistry
}): (ws: WebSocket, agentId: string) => void {
  // MED-8: חיבור FE WS פעיל אחד לכל agentId — מונע התנגשות מצב ACP בטאב שני
  const activeFeWs = new Map<string, WebSocket>()

  return function onConnect(feWs: WebSocket, agentId: string): void {
    const childLog = log.child({ agentId })

    // שומר MED-8
    if (activeFeWs.has(agentId)) {
      childLog.warn({}, "second tab rejected")
      feWs.close(1008, "agent in use by another tab")
      return
    }

    // presence check: האם agent קיים ב-connectionRegistry?
    const conn = deps.connectionRegistry.get(agentId)
    if (!conn) {
      childLog.warn({}, "agent not found")
      feWs.close(1008, "agent not found")
      return
    }

    activeFeWs.set(agentId, feWs)
    deps.connectionRegistry.markAttached(agentId)
    childLog.info({ pid: conn.pid }, "WS connect → pipe attached")

    // ── pipeChild — ניתוב ──────────────────────────────────────────────────────
    // conn.wire.onLine: subscriber לשורות stdout מה-child.
    // readline מסיר את ה-\n בסוף; מוסיפים \n כי ה-FE מצפה לו.
    // wire observability (in): מטופל ב-connectionRegistry (onFrame ב-connect) — שורד detach.
    const unsub = conn.wire.onLine((line) => {
      if (line.length === 0) return
      try {
        feWs.send(`${line}\n`)
      } catch {
        /* feWs נסגר */
      }
    })

    // הודעת feWs ל-child (conn.wire.write)
    // wire observability (out): onFrame ב-connectionRegistry כבר מכסה — לא כופלים כאן.
    feWs.on("message", (data) => {
      try {
        const text = data.toString()

        // keepalive ספציפי ל-WS — עונים $/pong ולא מעבירים ל-child.
        if (text.includes('"$/ping"')) {
          feWs.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`)
          return
        }

        const line = text.endsWith("\n") ? text : `${text}\n`
        conn.wire.write(line)
      } catch (err) {
        childLog.warn({ err }, "stdin write failed")
      }
    })

    // crash → close feWs
    const unsubCrash = conn.onCrash(() => {
      childLog.info({}, "child crashed — closing feWs")
      try {
        feWs.close(1011, "bridge closed")
      } catch {
        // כבר סגור
      }
    })

    // סגירת feWs לניקוי — אל תהרוג את ה-connection
    // detach() היא idempotent — גם אם error+close נורים ברצף, הניקוי מתבצע פעם אחת בלבד
    let detached = false
    function detach(reason: "close" | "error", err?: unknown): void {
      if (detached) return
      detached = true
      if (reason === "error")
        childLog.warn(
          { err: { code: (err as NodeJS.ErrnoException)?.code, message: String(err) } },
          "WS error — detaching pipe",
        )
      else childLog.info({}, "WS disconnect — detaching pipe")
      activeFeWs.delete(agentId)
      deps.connectionRegistry.markDetached(agentId)
      unsub()
      unsubCrash()
      // חשוב: לעולם לא conn.close() — ה-connection שורד התנתקות של ה-FE
    }

    feWs.on("error", (err) => detach("error", err))
    feWs.on("close", () => detach("close"))
  }
}
