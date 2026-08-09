/**
 * create-session-view.ts — createRemoteView(): factory שעוטפת createRemoteSessionView + connect().
 *
 * ⚠️ חתימות לא-תואמות: כאן `baseUrl` אופציונלי; ב-createRemoteSessionView (remote-session-view.ts)
 * הוא פרמטר-מיקום נדרש. העטיפה מספקת ערך מפורש: `baseUrl ?? beUrl("")` (same-origin —
 * התקדים ב-agents-api.ts).
 *
 * ─── slice view-switch C2 (TDD) ───
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
  const view = createRemoteSessionView(agentId, baseUrl ?? beUrl(""), rest)
  await view.connect()
  return view
}
