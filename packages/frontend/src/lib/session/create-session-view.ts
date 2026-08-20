/**
 * create-session-view.ts — createRemoteView(): factory שעוטפת createRemoteSessionView + connect().
 *
 * ⚠️ חתימות לא-תואמות: כאן `baseUrl` אופציונלי; ב-createRemoteSessionView (remote-session-view.ts)
 * הוא פרמטר-מיקום נדרש. העטיפה מספקת ערך מפורש: `baseUrl ?? beUrl("")` (same-origin —
 * התקדים ב-agents-api.ts).
 *
 * 🔴 מלכודת שנתפסה ב-C4 preview (לא ב-C1/C2 — הטסטים שם מזריקים baseUrl מפורש בלי
 * לוכסן-סוגר, אף פעם לא דרך beUrl("") האמיתי): `beUrl("")` מחזיר `location.origin` **עם**
 * לוכסן-סוגר (path="" → normalized="/" → `${origin}/`). RemoteSessionView#eventsUrl/
 * #rpcUrl/#replyUrl תמיד מוסיפים `/api/agents/...` — baseUrl עם לוכסן-סוגר ⇒ `//api/agents/...`
 * (לוכסן כפול). נצפה אמפירית ב-preview: attachRemote דרך דפדפן אמיתי נכשל-מהיר על
 * sessionId===null בכל ניסיון (curl ישיר עם baseUrl בלי לוכסן-סוגר עבד מושלם — ההבדל
 * היחיד). תוקן: קוצצים לוכסן-סוגר לפני השרשור.
 *
 * ─── slice view-switch C2 (TDD) + C4 (fix — נתפס ב-preview) ───
 */

import { beUrl } from "$lib/util/be-url.js"
import {
  createRemoteSessionView,
  type RemoteSessionView,
  type RemoteSessionViewOptions,
} from "./remote-session-view.js"

export async function createRemoteView(
  opts: { agentId: string; baseUrl?: string } & Partial<RemoteSessionViewOptions>,
): Promise<RemoteSessionView> {
  const { agentId, baseUrl, ...rest } = opts
  const resolvedBaseUrl = (baseUrl ?? beUrl("")).replace(/\/$/, "")
  const view = createRemoteSessionView(agentId, resolvedBaseUrl, rest)
  await view.connect()
  return view
}
