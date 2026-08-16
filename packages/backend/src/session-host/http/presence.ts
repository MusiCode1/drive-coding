/**
 * presence.ts — POST /api/agents/:id/presence (slice liveness C1).
 *
 * ה-FE שולח heartbeat אחד בכל מחזור-גלוי (~12ש׳). זהו **סימן-החיים היחיד שאינו
 * ניתן לזיוף** (§2 בבריף): "הלקוח שלח משהו לאחרונה". לא סוקט פתוח, לא כתיבה
 * שהצליחה — POST שהגיע בפועל.
 *
 * Body: אין. **אין אימות** (§5 — ה-BE נותר ללא אימות; Cloudflare Access הוא
 * השער. DoD לא בודק 403, ו-§9 אוסר לעצור על זה).
 *
 * תגובה — `{ ok, agent, machine }`:
 *   ok      — true (200; ה-touch התקבל). אין כאן assert על בעלות.
 *   agent   — runtime info של ה-agentId (null אם לא קיים) — attached/via/pid/busy.
 *             ה-FE משתמש ב-attached/via כדי לזהות אובדן-בעלות ולחזור אליו.
 *   machine — מדדי-מכונה (RAM/CPU), כך שהסקר בתוך-סשן כפול גם כעדכון-מכונה
 *             בלי קריאת /api/diag נפרדת.
 *
 * ⚠️ touchOwner רץ **תמיד** (לפני כל קצר-מטמון) — תופעת-הלוואי היא הנקודה;
 * התשובה היא מה שנכנס למטמון (C2).
 */

import os from "node:os"
import { deriveMachineStats } from "@drive-coding/core"
import type { Hono } from "hono"
import type { AgentSessionRegistry } from "../registry.js"

/**
 * registerPresenceRoute — registers POST /api/agents/:id/presence on the Hono app.
 */
export function registerPresenceRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.post("/api/agents/:id/presence", (c) => {
    const agentId = c.req.param("id")

    // liveness side effect — always, before anything else (C1 §2).
    registry.touchOwner(agentId)

    const agent = registry.getRuntimeInfo(agentId)
    const machine = deriveMachineStats({
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      loadAvg1: os.loadavg()[0] ?? 0, // ב-Windows loadavg() מחזיר [0,0,0] — memPct עדיין תקף
      cpuCount: os.cpus().length,
    })

    return c.json({ ok: true, agent, machine })
  })
}
