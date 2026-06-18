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
import { createLogger } from "@drive-coding/core/log"
import type { WebSocket } from "ws"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import { decodeWireLine } from "./wire-decode.js"
import type { WireRecorder } from "./wire-recorder.js"

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
  bridgeManager: {
    getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
    // ─── תצוגת active-agents (attached) ───
    markAttached(bridgeId: string): void
    markDetached(bridgeId: string): void
    // ─── slice agent-busy-indicator: subscription לשורות stdout ───
    onLine(bridgeId: string, cb: (line: string) => void): () => void
  }
  wireRecorder: WireRecorder
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

    const childOrNull = deps.bridgeManager.getChild(agentId)
    if (!childOrNull) {
      childLog.warn({}, "agent not found")
      feWs.close(1008, "agent not found")
      return
    }
    // non-null בוודאות — guard למעלה כבר הכריח return אם null
    const child = childOrNull

    activeFeWs.set(agentId, feWs)
    deps.bridgeManager.markAttached(agentId) // ← תצוגת active-agents (attached)
    childLog.info({ pid: child.pid }, "WS connect → pipe attached")

    // פתיחת session הקלטה (no-op כש-WIRE_RECORD כבוי)
    const rec = deps.wireRecorder.open(agentId)

    // ── pipeChild — ניתוב ──────────────────────────────────────────────────────
    // bridge-manager הוא הבעלים היחיד של child.stdout (reader קבוע ב-spawnInternal).
    // אנחנו נרשמים ל-onLine ומקבלים שורות כ-callback — לא קוראים את ה-stream ישירות.
    // readline מסיר את ה-\n בסוף; bridge-manager מעביר שורות נקיות — אנחנו מוסיפים \n
    // כי המפענח ndJsonStream של ה-FE משתמש ב-\n כגבול הודעה.
    const unsub = deps.bridgeManager.onLine(agentId, (line) => {
      if (line.length === 0) return
      try {
        feWs.send(`${line}\n`)
      } catch {
        // feWs נסגר
      }
      logWire("in", line) // האזנה (אחרי השליחה; מבודד מתקלות)
      rec.record("in", line) // הקלטה פסיבית (אחרי logWire)
    })

    // הודעת feWs ל-child.stdin (הוסף שורה חדשה אם חסר)
    feWs.on("message", (data) => {
      try {
        const text = data.toString()

        // keepalive ספציפי ל-WS (ר' ws-transport.ts) — עונים $/pong ולא מעבירים
        // ל-child. ה-$/ping הוא עניין transport-NAT שלא חל על stdio של סוכן ה-ACP,
        // ואסור שידלוף ל-stdin שלו.
        if (text.includes('"$/ping"')) {
          feWs.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`)
          logWire("out", "$/ping → $/pong")
          rec.record("out", text) // מקליט את ה-$/ping הגולמי (לא ה-summary של logWire)
          return
        }

        const line = text.endsWith("\n") ? text : `${text}\n`
        child.stdin.write(line)
        logWire("out", text.trim()) // האזנה (אחרי הכתיבה; trim מסיר \n סופי עבור פענוח)
        rec.record("out", text.trim()) // הקלטה פסיבית (אחרי logWire)
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
    // detach() היא idempotent — גם אם error+close נורים ברצף, הניקוי מתבצע פעם אחת בלבד
    let detached = false
    function detach(reason: "close" | "error", err?: unknown): void {
      if (detached) return
      detached = true
      if (reason === "error") childLog.warn({ err }, "WS error — detaching pipe")
      else childLog.info({}, "WS disconnect — detaching pipe")
      activeFeWs.delete(agentId)
      deps.bridgeManager.markDetached(agentId) // ← תצוגת active-agents (attached)
      unsub() // ← slice agent-busy-indicator: ביטול subscription ל-stdout
      rec.close() // סגירת stream הקלטה (no-op כש-WIRE_RECORD כבוי)
      child.off("exit", onChildExit)
      // חשוב: לעולם לא child.kill() — ה-child שורד התנתקות של ה-FE
    }

    feWs.on("error", (err) => detach("error", err))
    feWs.on("close", () => detach("close"))
  }
}
