/**
 * agent-recovery.ts — re-spawn agent אחרי BE restart.
 *
 * נקרא מ-`agent-session.svelte.ts:connect()` כשה-GET ל-/api/agents/<id>
 * מחזיר 404. הflow:
 *   1. שולפים metadata מ-localStorage (אם נשמר ב-createAgent)
 *   2. שולפים lastSessionId אחרון מ-/api/projects (source of truth)
 *   3. שולחים POST /api/agents חדש עם existingSessionId
 *   4. מנווטים ל-URL החדש (replaceState — ה-URL הישן נמחק מהHistory)
 *   5. ב-failure: notification + ניווט ל-dashboard
 *
 * אם אין cache: notification "הסוכן נסגר" + ניווט ל-dashboard.
 */

import type { CliKind } from "@drive-coding/core"
import { goto } from "$app/navigation"
import { createAgent } from "$lib/api/agents"
import { listProjects } from "$lib/api/sessions"
import { createLogger } from "$lib/log"
import { clearAgentMetadata, loadAgentMetadata } from "./agent-storage"
import { notifications } from "./notifications-store.svelte"

const log = createLogger("fe.stores.agent-recovery")

/**
 * Try to recover a missing agent. Always navigates somewhere — never returns
 * to the caller's flow. Caller should treat this as a control-transfer.
 */
export async function recoverAgent(oldAgentId: string): Promise<void> {
  const meta = loadAgentMetadata(oldAgentId)
  if (!meta) {
    log.warn({ oldAgentId }, "no cache for old agentId — cannot recover")
    notifications.push("הסוכן הקודם נסגר ולא ניתן לשחזרו. בחר/י פרויקט להמשך.", "info")
    await goto("/", { replaceState: true })
    return
  }

  // Prefer lastSessionId from BE projects-registry (source of truth) over
  // the cache (which might be stale if the user worked from another device).
  let existingSessionId: string | undefined = meta.acpSessionId ?? undefined
  let cliKind: string = meta.cliKind
  try {
    const projects = await listProjects()
    const match = projects.find((p) => p.cwd === meta.cwd)
    if (match?.lastSessionId) existingSessionId = match.lastSessionId
    if (match?.kind) cliKind = match.kind
  } catch (e) {
    log.warn({ err: String(e) }, "listProjects failed — using cache fallback only")
  }

  log.info(
    { oldAgentId, cwd: meta.cwd, cliKind, existingSessionId },
    "attempting recovery via POST /api/agents",
  )

  try {
    const fresh = await createAgent({
      cwd: meta.cwd,
      cliKind: cliKind as CliKind,
      existingSessionId,
      modelOverride: meta.modelOverride,
    })
    // Old cache will eventually expire (TTL). Clear now to keep storage clean.
    clearAgentMetadata(oldAgentId)
    log.info({ oldAgentId, newAgentId: fresh.agentId }, "recovery ok")
    await goto(`/agent/${fresh.agentId}`, { replaceState: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn({ oldAgentId, err: msg }, "recovery failed")
    clearAgentMetadata(oldAgentId)
    notifications.push(`שחזור הסוכן נכשל: ${msg}`, "error")
    await goto("/", { replaceState: true })
  }
}
