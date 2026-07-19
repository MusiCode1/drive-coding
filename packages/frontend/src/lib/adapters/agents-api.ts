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

// TODO(review-fixes-2): getAgent — אין צרכן בקוד כרגע (grep ב-2026-06-02). לבדוק אם
// מישהו משתמש בזה לפני שמשקיעים בו timeout/error-handling (F4). אם dead — למחוק בסבב נפרד.
export async function getAgent(
  agentId: string,
): Promise<{ agent: { cwd: string; status: string } }> {
  const res = await fetch(beUrl(`/api/agents/${agentId}`))
  if (!res.ok) {
    throw new Error(`getAgent failed: ${res.status}`)
  }
  return (await res.json()) as { agent: { cwd: string; status: string } }
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
    (s) =>
      fetch(beUrl(`/api/agents/${agentId}`), { method: "DELETE", signal: s }),
    AGENTS_API_TIMEOUT_MS,
    { label: "deleteAgent" },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`deleteAgent failed: ${res.status} ${body}`)
  }
}

/** משנה את דגל הנעיצה (persistent) של agent. */
export async function setAgentPersistent(
  agentId: string,
  persistent: boolean,
): Promise<void> {
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
