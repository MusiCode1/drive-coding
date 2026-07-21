/**
 * agents-api.ts — לקוח REST מינימלי עבור /api/agents.
 *
 * מספיק בדיוק כדי לתמוך ב: יצירת סוכן, קבלת מידע על הסוכן, מחיקת סוכן.
 * ללא ניסיונות חוזרים, ללא וולידציית סכמה — נתיב מהיר ל-v2.
 */

import type { AgentPublic, CliKind } from "@drive-coding/core"
import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { beUrl } from "$lib/util/be-url"

const AGENTS_API_TIMEOUT_MS = 10000 // קריאות API קצרות; BE מקומי בדר"כ < 1s

export type CreateAgentInput = {
  cwd: string
  cliKind: CliKind
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
 */
export async function getAgent(
  agentId: string,
): Promise<{ agent: { cwd: string; status: string; crashReason?: string } }> {
  const res = await fetch(beUrl(`/api/agents/${agentId}`))
  if (!res.ok) {
    throw new Error(`getAgent failed: ${res.status}`)
  }
  return (await res.json()) as { agent: { cwd: string; status: string; crashReason?: string } }
}

export async function notifySessionAttached(
  agentId: string,
  sessionId: string,
  opts?: { replace?: boolean },
): Promise<void> {
  await withTimeout(
    (s) =>
      fetch(beUrl(`/api/agents/${agentId}/session-attached`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...(opts?.replace ? { replace: true } : {}) }),
        signal: s,
      }),
    AGENTS_API_TIMEOUT_MS,
    { label: "notifySessionAttached" },
  )
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

/** משנה את דגל הנעיצה (persistent) של agent. */
export async function setAgentPersistent(agentId: string, persistent: boolean): Promise<void> {
  const res = await withTimeout(
    (s) =>
      fetch(beUrl(`/api/agents/${agentId}/persistent`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persistent }),
        signal: s,
      }),
    AGENTS_API_TIMEOUT_MS,
    { label: "setAgentPersistent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`setAgentPersistent failed: ${res.status} ${body}`)
  }
}
