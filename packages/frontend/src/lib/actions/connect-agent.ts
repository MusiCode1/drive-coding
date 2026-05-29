/**
 * connect-agent.ts — מנהל את תהליך החיבור (connect flow).
 *
 * 1. שומר את ערכי הטופס לתוך ההגדרות (כדי שיישמרו).
 * 2. מצרף את ה-session.
 * 3. מנווט אל /chat במקרה של הצלחה.
 *
 * זוהי Action (ולא מתודה על Settings או AgentSession) מכיוון שהיא משלבת
 * מספר view-models יחד עם ניווט — דוגמה קלאסית לעניין חוצה שכבות.
 */

import { goto } from "$app/navigation"
import type { CliKind } from "@drive-coding/core"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Settings } from "$lib/view-models/settings.svelte"

export async function connectAgent(params: {
  cliKind: CliKind
  cwd: string
  session: AgentSession
  settings: Settings
}): Promise<void> {
  params.settings.setCliKind(params.cliKind)
  params.settings.setLastCwd(params.cwd)

  await params.session.attach({ cwd: params.cwd, cliKind: params.cliKind })

  if (params.session.status === "connected") {
    await goto("/chat")
  }
  // במקרה של שגיאה, ה-session VM כבר הגדיר status="error" + הודעת שגיאה.
  // דף החיבור ירנדר את זה — ללא ניווט.
}
