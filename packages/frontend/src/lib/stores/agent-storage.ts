/**
 * agent-storage.ts — localStorage cache של נתוני agent ל-recovery אחרי BE restart.
 *
 * הצורך: ה-BE in-memory (D8). אחרי restart הוא לא מכיר agentId-ים ישנים.
 * אנחנו שומרים ב-FE את המידע שצריך כדי להפעיל מחדש: cwd, cliKind, sessionId אחרון,
 * model override. ה-recovery flow קורא ל-loadAgentMetadata, שולח POST /api/agents חדש,
 * ועובר ל-agentId החדש.
 *
 * Key: "voice-acp:agent:<agentId>"
 * TTL: 7 ימים (סביר ל-bookmarks וקצר מספיק שלא יצטבר זבל)
 *
 * Validation: ArkType — הנתונים באים מ-localStorage שיכול להישבר בין גירסאות
 * או להיערך ידנית ב-DevTools. כל קריאה עוברת schema, ב-fail אנחנו מוחקים.
 */

import { type } from "arktype"
import { createLogger } from "$lib/log"

const log = createLogger("fe.stores.agent-storage")

const KEY_PREFIX = "voice-acp:agent:"
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Schema של AgentMetadata.
 * Non-strict — שדות נוספים שלא בschema לא יפילו את ה-parse (forward-compat).
 */
const AgentMetadataSchema = type({
  agentId: "string > 0",
  cwd: "string > 0",
  cliKind: "string > 0",
  acpSessionId: "string | null",
  modelOverride: "string | null",
  savedAt: "number > 0",
})

export type AgentMetadata = typeof AgentMetadataSchema.infer

/**
 * שומר metadata. תמיד דורסת savedAt בtimestamp עכשווי.
 * שגיאות (quota, storage unavailable) נבלעות בשקט — זה cache best-effort.
 */
export function saveAgentMetadata(meta: Omit<AgentMetadata, "savedAt">): void {
  try {
    const full: AgentMetadata = { ...meta, savedAt: Date.now() }
    localStorage.setItem(KEY_PREFIX + meta.agentId, JSON.stringify(full))
  } catch (e) {
    log.warn({ agentId: meta.agentId, err: String(e) }, "save failed (quota or unavailable)")
  }
}

/**
 * טוען metadata לפי agentId.
 * מחזיר null במקרים: missing key, JSON שבור, schema פסול, expired (TTL).
 * במקרים של JSON שבור או schema פסול — מוחק את הכניסה כדי לא להשאיר זבל.
 */
export function loadAgentMetadata(agentId: string): AgentMetadata | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + agentId)
    if (!raw) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      log.warn({ agentId }, "corrupt JSON in cache — removing")
      localStorage.removeItem(KEY_PREFIX + agentId)
      return null
    }

    const result = AgentMetadataSchema(parsed)
    if (result instanceof type.errors) {
      log.warn({ agentId, errors: result.summary }, "schema mismatch — removing")
      localStorage.removeItem(KEY_PREFIX + agentId)
      return null
    }

    if (Date.now() - result.savedAt > TTL_MS) {
      log.info({ agentId }, "cache expired — removing")
      localStorage.removeItem(KEY_PREFIX + agentId)
      return null
    }

    return result
  } catch (e) {
    log.warn({ agentId, err: String(e) }, "load failed unexpectedly")
    return null
  }
}

/**
 * מוחק כניסה בודדת. נקרא ב-deleteAgent ובסיום מוצלח של recovery.
 */
export function clearAgentMetadata(agentId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + agentId)
  } catch (e) {
    log.warn({ agentId, err: String(e) }, "clear failed")
  }
}
