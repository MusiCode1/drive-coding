/**
 * agents-api.ts — לקוח REST מינימלי עבור /api/agents.
 *
 * מספיק בדיוק כדי לתמוך ב: יצירת סוכן, קבלת מידע על הסוכן, מחיקת סוכן.
 * ללא ניסיונות חוזרים, ללא וולידציית סכמה — נתיב מהיר ל-v2.
 */

import type { AgentPublic } from "@drive-coding/core"
import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { beUrl } from "$lib/util/be-url"

const AGENTS_API_TIMEOUT_MS = 10000 // קריאות API קצרות; BE מקומי בדר"כ < 1s

export type CreateAgentInput = {
  cwd: string
  cliKind: string
  modelOverride?: string | null
  existingSessionId?: string
  // slice project-system-prompt: פרומפט-מערכת פר-פרויקט, מתווסף (append) בתוך provider.
  systemPrompt?: string | null
}

export type CreateAgentResponse = {
  agentId: string
  acpSessionId?: string
  status: string
}

export async function createAgent(
  input: CreateAgentInput,
  signal?: AbortSignal,
): Promise<CreateAgentResponse> {
  const res = await withTimeout(
    (s) =>
      fetch(beUrl("/api/agents"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: s,
      }),
    AGENTS_API_TIMEOUT_MS,
    { signal, label: "createAgent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`createAgent failed: ${res.status} ${body}`)
  }
  return (await res.json()) as CreateAgentResponse
}

/** מושך את רשימת הסוכנים הפעילים מה-BE (GET /api/agents). */
export async function listAgents(signal?: AbortSignal): Promise<AgentPublic[]> {
  const res = await withTimeout(
    (s) => fetch(beUrl("/api/agents"), { signal: s }),
    AGENTS_API_TIMEOUT_MS,
    { signal, label: "listAgents" },
  )
  if (!res.ok) throw new Error(`listAgents failed: ${res.status}`)
  const body = (await res.json()) as { agents: AgentPublic[] }
  return body.agents
}

/**
 * מושך מידע על agent בודד (GET /api/agents/:id) — כולל `crashReason` (מאוכלס ע"י
 * `describeCrash` ב-BE כש-status="crashed"). צרכן: `#handleUnexpectedClose` בסלייס
 * surface-real-error, Commit 3 — best-effort לזיהוי child-crash (ENOENT/credit/וכו')
 * אחרי סגירת WS לא-צפויה, כדי להציג את הסיבה האמיתית במקום "WS closed" גנרי.
 *
 * עטוף ב-withTimeout (calev-heavy §10.1, Commit 4): קריאה חשופה בלי timeout הייתה
 * חוסמת את ה-reconnect אם ה-BE תקוע/לא-נגיש — `#handleUnexpectedClose` ממתין ל-getAgent
 * לפני `#scheduleReconnect()`, ו-`.catch()` לא עוזר ל-hang.
 */
export async function getAgent(
  agentId: string,
  signal?: AbortSignal,
): Promise<{ agent: { cwd: string; status: string; crashReason?: string } }> {
  const res = await withTimeout(
    (s) => fetch(beUrl(`/api/agents/${agentId}`), { signal: s }),
    AGENTS_API_TIMEOUT_MS,
    { signal, label: "getAgent" },
  )
  if (!res.ok) {
    throw new Error(`getAgent failed: ${res.status}`)
  }
  return (await res.json()) as { agent: { cwd: string; status: string; crashReason?: string } }
}

/**
 * notifySessionAttached — עדכון "עובדת-חיבור" (acpSessionId + cwd אופציונלי) דרך
 * PATCH הגנרי (slice agent-patch-unify, C3). מבטל את POST …/session-attached — אותה
 * חתימה ציבורית, גוף מאציל ל-patchAgent. `opts.cwd` נשלח רק בשני אתרים בלבד
 * (switchSession, newSession — §3.5 D6 בבריף); שאר האתרים משמיטים אותו במכוון.
 */
export async function notifySessionAttached(
  agentId: string,
  sessionId: string,
  opts?: { replace?: boolean; cwd?: string },
): Promise<void> {
  await patchAgent(agentId, {
    acpSessionId: sessionId,
    ...(opts?.replace ? { replace: true } : {}),
    ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
  })
}

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await withTimeout(
    (s) => fetch(beUrl(`/api/agents/${agentId}`), { method: "DELETE", signal: s }),
    AGENTS_API_TIMEOUT_MS,
    { label: "deleteAgent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`deleteAgent failed: ${res.status} ${body}`)
  }
}

/**
 * הגוף הכולל של ה-PATCH הגנרי (slice agent-patch-unify, C3) — דלת אחת במקום שלוש
 * (POST …/session-attached, POST …/persistent, PATCH {title}). תואם 1:1 ל-`PatchAgentInput`
 * ב-http-agents.ts. `replace` הוא דגל-בקרה (D3) — לא שדה-רישום.
 */
export type PatchAgentBody = {
  title?: string | null
  persistent?: boolean
  acpSessionId?: string
  status?: "ready"
  cwd?: string
  replace?: boolean
}

/**
 * עדכון גנרי של agent דרך PATCH /api/agents/:id — דלת אחת (slice agent-patch-unify).
 * best-effort אצל הקורא (slice session-title-in-process-list — הדגם הראשון).
 */
export async function patchAgent(
  agentId: string,
  patch: PatchAgentBody,
  signal?: AbortSignal,
): Promise<void> {
  const res = await withTimeout(
    (s) =>
      fetch(beUrl(`/api/agents/${agentId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        signal: s,
      }),
    AGENTS_API_TIMEOUT_MS,
    { signal, label: "patchAgent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`patchAgent failed: ${res.status} ${body}`)
  }
}

/**
 * משנה את דגל הנעיצה (persistent) של agent — שדה-משתמש, דרך PATCH הגנרי
 * (slice agent-patch-unify, C3). מבטל את POST …/persistent — אותה חתימה ציבורית.
 */
export async function setAgentPersistent(agentId: string, persistent: boolean): Promise<void> {
  await patchAgent(agentId, { persistent })
}

/**
 * postPresence — POST /api/agents/:id/presence (slice liveness C3).
 *
 * סימן-החיים היחיד שאינו ניתן לזיוף (§2 בבריף): ה-FE שולח heartbeat אחד בכל
 * מחזור-גלוי. התגובה נושאת את מצב-הבעלות (agent.attached / agent.via) כדי שה-FE
 * יזהה אובדן-בעלות ויחזור אליו, ואת מדדי-המכונה. timeout קצר (לא ממתינים ל-10ש׳
 * של קריאות API רגילות — heartbeat כושל חייב להיכשל מהר כדי שהבאנר יופיע בזמן).
 */
export type PresenceResponse = {
  ok: boolean
  agent: {
    pid: number | null
    attached: boolean
    busy: boolean
    lastMessageAt: number | null
    lastSeenAt: number | null
    via: "ws" | "http" | null
  } | null
  machine: unknown
}

const PRESENCE_TIMEOUT_MS = 5000

export async function postPresence(agentId: string, signal?: AbortSignal): Promise<PresenceResponse> {
  const res = await withTimeout(
    (s) =>
      fetch(beUrl(`/api/agents/${agentId}/presence`), {
        method: "POST",
        signal: s,
      }),
    PRESENCE_TIMEOUT_MS,
    { signal, label: "postPresence" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`postPresence failed: ${res.status} ${body}`)
  }
  return (await res.json()) as PresenceResponse
}
