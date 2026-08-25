/**
 * connect-agent.ts — מנהל את תהליך החיבור (connect flow).
 *
 * 1. שומר את ערכי הטופס לתוך ההגדרות (כדי שיישמרו).
 * 2. פותר את דגל sessionTransport (query ← override ← stored ← env ← "ws") ומצרף את ה-session
 *    במצב המתאים (attach מקומי ws / attachRemote http).
 * 3. מנווט אל /chat במקרה של הצלחה.
 *
 * זוהי Action (ולא מתודה על Settings או AgentSession) מכיוון שהיא משלבת
 * מספר view-models יחד עם ניווט — דוגמה קלאסית לעניין חוצה שכבות.
 *
 * ─── slice view-switch C3-ז: נקודות ההזרקה של sessionTransport ─── (additive)
 * ❌ אל תפזר `if (transport === "http")` מחוץ לנקודות אלה — כל הניתוב האחר ב-VM
 * הוא לפי `#view !== null`, לא לפי הדגל (הדגל בנקודה אחת).
 * נקודות: connect-agent.ts · handleReconnect (+page.svelte) · open-session-url.ts
 */

import { goto } from "$app/navigation"
import { env } from "$env/dynamic/public"
import { readSessionTransport } from "$lib/session/session-transport-read"
import { sessionPath } from "$lib/session/session-url"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"

export async function connectAgent(params: {
  cliKind: string
  cwd: string
  session: AgentSession
  settings: Settings
}): Promise<void> {
  params.settings.setCliKind(params.cliKind)
  params.settings.setLastCwd(params.cwd)

  // slice remote-warm-reconnect C4 / transport-polish C2: פתירת הדגל עברה לפונקציה
  // המשותפת — query ← override(sessionStorage) ← stored(settings) ← env ← "ws",
  // + שמירת ה-query המנורמל ל-sessionStorage (זבל לא נשמר).
  const transport = readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: params.settings.sessionTransport,
  })

  if (transport === "http") {
    // slice http-cold-parity: attachRemote מקבל systemPrompt כעת — שני הענפים
    // (http/ws) מעבירים אותו הלאה עם אותו ביטוי בדיוק.
    await params.session.attachRemote({
      cwd: params.cwd,
      cliKind: params.cliKind,
      systemPrompt: params.settings.getProjectPrompt(params.cwd),
    })
  } else {
    // slice project-system-prompt: שולף את הפרומפט השמור לפרויקט (cwd) מ-Settings — ה-VM
    // עצמו לא מחזיק Settings, ה-action (שכבת חוצה-VM) היא המקום הנכון לשלוף (§9 Q1).
    await params.session.attach({
      cwd: params.cwd,
      cliKind: params.cliKind,
      systemPrompt: params.settings.getProjectPrompt(params.cwd),
    })
  }

  if (params.session.status === "connected") {
    const sid = params.session.sessionId
    if (transport === "http") {
      await goto(
        sid !== null
          ? `${sessionPath(params.cliKind, sid)}?sessionTransport=http`
          : "/chat?sessionTransport=http",
      )
    } else {
      await goto(sid !== null ? sessionPath(params.cliKind, sid) : "/chat")
    }
  }
  // במקרה של שגיאה, ה-session VM כבר הגדיר status="error" + הודעת שגיאה.
  // דף החיבור ירנדר את זה — ללא ניווט.
}
