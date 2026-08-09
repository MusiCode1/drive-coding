/**
 * connect-agent.ts — מנהל את תהליך החיבור (connect flow).
 *
 * 1. שומר את ערכי הטופס לתוך ההגדרות (כדי שיישמרו).
 * 2. פותר את דגל sessionTransport (query ← stored ← env ← local) ומצרף את ה-session
 *    במצב המתאים (attach מקומי / attachRemote מרוחק).
 * 3. מנווט אל /chat במקרה של הצלחה.
 *
 * זוהי Action (ולא מתודה על Settings או AgentSession) מכיוון שהיא משלבת
 * מספר view-models יחד עם ניווט — דוגמה קלאסית לעניין חוצה שכבות.
 *
 * ─── slice view-switch C3-ז: נקודת-ההזרקה היחידה של sessionTransport ─── (additive)
 * ❌ אל תפזר `if (transport === "remote")` מחוץ לקובץ הזה — כל הניתוב האחר ב-VM
 * הוא לפי `#view !== null`, לא לפי הדגל (הדגל בנקודה אחת).
 */

import { goto } from "$app/navigation"
import { env } from "$env/dynamic/public"
import { resolveSessionTransport } from "$lib/session/session-transport"
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

  // `?sessionTransport=` לא שורד goto("/chat")/refresh — נשמר ל-sessionStorage כדי
  // שהמשתמשת לא תתחבר ב-local בלי לדעת באמצע ה-preview (C4).
  const q = new URLSearchParams(location.search).get("sessionTransport")
  if (q) sessionStorage.setItem("sessionTransport", q)
  const transport = resolveSessionTransport({
    query: q,
    stored: sessionStorage.getItem("sessionTransport"),
    env: env.PUBLIC_SESSION_TRANSPORT,
  })

  if (transport === "remote") {
    await params.session.attachRemote({ cwd: params.cwd, cliKind: params.cliKind })
    // ⚠️ systemPrompt אינו נתמך ב-remote (attachRemote אין לו פרמטר כזה) — known-gap מתועד.
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
    await goto(transport === "remote" ? "/chat?sessionTransport=remote" : "/chat")
  }
  // במקרה של שגיאה, ה-session VM כבר הגדיר status="error" + הודעת שגיאה.
  // דף החיבור ירנדר את זה — ללא ניווט.
}
