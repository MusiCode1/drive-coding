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
 *   - MED-8 → takeover (slice reconnect-ws-takeover, תיקון-שורש): WS חדש לאותו agentId
 *     לא נדחה יותר — הוא **מדיח** את הישן (close TAKEOVER_CODE) ומתחבר warm לאותו
 *     agent חי (נפילה-דרך ל-attach הרגיל). מונע cold-respawn (deleteAndKill) שהרג
 *     תור פעיל בניתוק-רשת לא-חלק. ר' docs/decisions/drive-coding.md §2026-07-22.
 *   - crash → סוגר feWs.close(1011, "bridge closed")
 *   - סגירת feWs → ניקוי (unsub + detach), לא להרוג את ה-child (conn.close לא נקרא)
 *     — guard-ממוקד ב-detach(): רק ה-state המשותף (activeFeWs/markDetached) מוגן
 *     מפני takeover-race; unsub/unsubCrash הפרטיים-ל-ws תמיד רצים.
 */

import { createLogger } from "@drive-coding/core/log"
import type { WebSocket } from "ws"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"

const log = createLogger("backend.ws.agent")

// slice reconnect-ws-takeover: application close code — dedicated (not 1000/1006/1008/1011)
// so the FE can distinguish "evicted by a newer connection" from a real drop and skip
// auto-reconnect (prevents an infinite takeover ping-pong between two tabs/devices).
// ⚠️ Must match TAKEOVER_CLOSE_CODE in packages/frontend/src/lib/view-models/agent-session.svelte.ts.
export const TAKEOVER_CODE = 4409

// ─── סוגים ────────────────────────────────────────────────────────────────────

export type AgentWsData = {
  kind: "agent"
  agentId: string
  bridgeWs?: undefined
  pendingFromFe: Array<string | Buffer>
  bridgeOpen: boolean
}

// ─── פקטורית טיפולן ──────────────────────────────────────────────────────────

// ── Stale-client sweep ────────────────────────────────────────────────────────
// הFE שולח $/ping כל 25s (ws-transport.ts). אם אחרי STALE_MS לא הגיע ping,
// הלקוח מת (קריסת דפדפן, רשת שנפלה) — terminate ה-WS → "close" → detach().
// sweep.unref() = לא מונע exit של ה-BE.
const STALE_MS = 60_000 // 2+ פעימות שהוחמצו (FE שולח כל 25s)

export function createAgentWsHandler(deps: {
  orchestrator: AgentOrchestrator
  connectionRegistry: ConnectionRegistry
  /**
   * slice remote-warm-reconnect C2 (כיוון WS→host, אופציונלי): אם יש SessionHost חי
   * על הסוכן — דחה את ה-WS. שני לקוחות ACP על אותו conn.wire (שניהם onLine + write)
   * = השחתת סשן; ה-host הוא הבעלים של ה-wire. אופציונלי — נתיב local בלי host
   * ממשיך בדיוק כמו קודם (כולל הטסטים הקיימים שלא מזריקים את ה-dep).
   */
  sessionHostRegistry?: { getHost(agentId: string): unknown }
}): (ws: WebSocket, agentId: string) => void {
  // MED-8: חיבור FE WS פעיל אחד לכל agentId — מונע התנגשות מצב ACP בטאב שני
  // הרחבה מ-Commit 2: {ws, lastPingAt} לניהול sweep
  const activeFeWs = new Map<string, { ws: WebSocket; lastPingAt: number }>()

  // sweep: terminate WS של לקוח שלא שלח ping בזמן (קליינט-מת)
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [, e] of activeFeWs) {
      if (now - e.lastPingAt > STALE_MS) e.ws.terminate()
    }
  }, 20_000)
  sweep.unref()

  return function onConnect(feWs: WebSocket, agentId: string): void {
    const childLog = log.child({ agentId })

    // שומר MED-8 → takeover (slice reconnect-ws-takeover, תיקון-שורש): WS חדש **מדיח**
    // את הישן במקום להידחות. מונע: ניתוק-רשת לא-חלק → feWs ישן half-open → הישן היה
    // דוחה את החדש ב-1008 → FE נופל ל-cold-respawn → deleteAndKill הורג את התור הפעיל.
    const existing = activeFeWs.get(agentId)
    if (existing) {
      // observability: מאבחנים האם ה-WS הישן חי (readyState=1=OPEN → tab-שני-אמיתי)
      // או רפאים (2=CLOSING/3=CLOSED, או ping ישן → קליינט-מת). readyState 0=CONNECTING/1=OPEN.
      childLog.warn(
        {
          existingReadyState: existing.ws.readyState,
          msSinceLastPing: Date.now() - existing.lastPingAt,
        },
        "taking over — evicting existing feWs",
      )
      // הדח את הישן. קוד ייעודי (לא 1000/1006/1008/1011) — ה-FE מזהה אותו ולא מנסה
      // reconnect (מונע ping-pong: הישן ידיח את החדש בחזרה).
      existing.ws.close(TAKEOVER_CODE, "taken over by new connection")
      // נפול-דרך (בכוונה, בלי return) ל-attach הרגיל של feWs החדש למטה. ה-detach() של
      // הישן ירוץ async (כשה-close event שלו יגיע) — עד אז activeFeWs.set (למטה, לפני
      // ה-return מהפונקציה הזו) כבר יחליף את הערך, וה-guard ב-detach() ידלג על הניקוי
      // של ה-state המשותף (takeover race — §4 Commit 0 בבריף).
    }

    // presence check: האם agent קיים ב-connectionRegistry?
    const conn = deps.connectionRegistry.get(agentId)
    if (!conn) {
      childLog.warn({}, "agent not found")
      feWs.close(1008, "agent not found")
      return
    }

    // slice remote-warm-reconnect C2 (WS→host): host חי על ה-agent ⇒ ה-wire תפוס —
    // WS מקביל היה כותב קריאות ACP שניות לתוך אותו צינור (השחתה). סוגרים ב-1008
    // (policy violation) אחרי ה-presence check ולפני activeFeWs.set/markAttached.
    if (deps.sessionHostRegistry?.getHost(agentId)) {
      childLog.warn({}, "session host active on this agent — rejecting WS attach")
      feWs.close(1008, "session-host-active")
      return
    }

    activeFeWs.set(agentId, { ws: feWs, lastPingAt: Date.now() })
    deps.connectionRegistry.markAttached(agentId)
    childLog.info({ pid: conn.pid }, "WS connect → pipe attached")

    // ── capability delivery (CUT-3b-iii-2): שלח _drive/capabilities ל-FE ────────
    // conn.capabilities נגיש מיד אחרי connect (static per-provider).
    // שולחים כ-JSON-RPC notification (extNotification) אחרי markAttached.
    // ה-FE יקרא ל-_drive/capabilities listener (FE-normalization slice).
    // נשלח באופן synchronous (לפני onLine subscription) — FE מקבל caps לפני אירועים.
    try {
      const capsFrame = JSON.stringify({
        jsonrpc: "2.0",
        method: "_drive/capabilities",
        params: conn.capabilities,
      })
      feWs.send(`${capsFrame}\n`)
      childLog.debug({ capabilities: conn.capabilities }, "_drive/capabilities sent to FE")
    } catch {
      /* feWs may have closed between connect and here — non-fatal */
    }

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
          // עדכן lastPingAt (sweep detection — Commit 2)
          const entry = activeFeWs.get(agentId)
          if (entry) entry.lastPingAt = Date.now()
          feWs.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/pong" })}\n`)
          return
        }

        // $/detach — FE מודיע שהוא עוזב מרצון (leaveRunning / #cleanup) — Commit 3
        if (text.includes('"$/detach"')) {
          deps.connectionRegistry.markDetached(agentId)
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
      // takeover-race guard (slice reconnect-ws-takeover, §4 Commit 0): שני סוגי ניקוי —
      // (א) state משותף (activeFeWs/markDetached) — מוגן: אם feWs זה כבר הוחלף ע"י takeover
      // (activeFeWs מצביע על ws אחר), אין לדרוס את הרישום של ה-WS החדש/חי.
      // (ב) פרטי-ל-ws (unsub/unsubCrash) — תמיד רץ: מנקה את ה-subscriber של ה-WS הזה
      // בדיוק, בלי קשר לתקפות ה-state המשותף.
      if (activeFeWs.get(agentId)?.ws === feWs) {
        activeFeWs.delete(agentId)
        deps.connectionRegistry.markDetached(agentId)
      }
      unsub()
      unsubCrash()
      // חשוב: לעולם לא conn.close() — ה-connection שורד התנתקות של ה-FE
    }

    feWs.on("error", (err) => detach("error", err))
    feWs.on("close", () => detach("close"))
  }
}
