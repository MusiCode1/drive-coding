/**
 * ws-agent.ts — צינור בתי WebSocket עבור /ws/agent/:id
 *
 * Phase 3: צינור ישיר in-process מ-feWs ל-child.stdin/stdout.
 * אין צורך בתהליך WS bridge מתווך.
 *
 * ארכיטקטורה:
 *   feWs (ws.WebSocket מדפדפן ה-FE)
 *     ↕ readline + stdin.write
 *   child (ChildProcess שהופעל על ידי bridge-manager)
 *
 * מקרי קצה:
 *   - סוכן לא נמצא → סוגר close(1008, "agent not found")
 *   - MED-8: טאב שני לאותו agentId → סוגר close(1008, "agent in use by another tab")
 *   - יציאת ה-child → סוגר feWs.close(1011, "bridge closed")
 *   - סגירת feWs → ניקוי (rl.close + detach), לא להרוג את ה-child (NO child.kill)
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { createLogger } from "@drive-coding/core/log"
import type { WebSocket } from "ws"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { decodeWireLine } from "./wire-decode.js"

const log = createLogger("backend.ws.agent")
const wireLog = createLogger("backend.ws.wire")

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
  bridgeManager: { getChild(bridgeId: string): ChildProcessWithoutNullStreams | null }
}): (ws: WebSocket, agentId: string) => void {
  // MED-8: חיבור FE WS פעיל אחד לכל agentId — מונע התנגשות מצב ACP בטאב שני
  const activeFeWs = new Map<string, WebSocket>()

  return function onConnect(feWs: WebSocket, agentId: string): void {
    const childLog = log.child({ agentId })
    const childWireLog = wireLog.child({ agentId })

    function logWire(dir: "in" | "out", raw: string): void {
      try {
        const s = decodeWireLine(raw)
        const type = s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
        childWireLog.debug({ dir, type, id: s.id }, "wire")
        if (!s.unparsed) childWireLog.trace({ dir, frame: s.parsed }, "wire-full")
      } catch {
        // לעולם אל תיתן ללוגים לשבור את הצינור
      }
    }

    // שומר MED-8
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

    // ── pipeChild — ניתוב ──────────────────────────────────────────────────────
    // מ-child.stdout (שורות NDJSON) ל-feWs.send
    // readline מסיר את ה-\n בסוף; אנחנו חייבים להוסיף אותו מחדש כי המפענח
    // ndJsonStream של ה-FE משתמש ב-\n כגבול הודעה (בלעדיו ה-SDK שומר
    // בחוצץ פריים חלקי ולעולם לא מסיים את הבקשה הממתינה).
    child.stdout.setEncoding("utf8")
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on("line", (line) => {
      if (line.length === 0) return
      try {
        feWs.send(`${line}\n`)
      } catch {
        // feWs נסגר
      }
      logWire("in", line) // האזנה (אחרי השליחה; מבודד מתקלות)
    })

    // הודעת feWs ל-child.stdin (הוסף שורה חדשה אם חסר)
    feWs.on("message", (data) => {
      try {
        const text = data.toString()
        const line = text.endsWith("\n") ? text : `${text}\n`
        child.stdin.write(line)
        logWire("out", text.trim()) // האזנה (אחרי הכתיבה; trim מסיר \n סופי עבור פענוח)
      } catch (err) {
        childLog.warn({ err }, "stdin write failed")
      }
    })

    // יציאת ה-child ל-close feWs
    const onChildExit = (code: number | null) => {
      childLog.info({ code }, "child exited — closing feWs")
      try {
        feWs.close(1011, "bridge closed")
      } catch {
        // כבר סגור
      }
    }
    child.once("exit", onChildExit)

    // סגירת feWs לניקוי, אבל אל תהרוג את ה-child
    feWs.on("close", () => {
      childLog.info({}, "WS disconnect — detaching pipe")
      activeFeWs.delete(agentId)
      rl.close()
      child.off("exit", onChildExit)
      // חשוב: אל תקרא ל-child.kill() — ה-child שורד התנתקות של ה-FE
    })
  }
}
