/**
 * plan.ts — ArkType schemas + reducer טהור למשפחת ה-`plan` (ACP session/update).
 *
 * מקור-האמת ל-shape: `@agentclientprotocol/sdk` schema.json (installed, לא ניחוש):
 *   - `{sessionUpdate:"plan", entries:[...]}` — snapshot יציב (ChatGPT/claude חי, אומת §1).
 *   - `{sessionUpdate:"plan_update", plan:{type:"items"|"file"|"markdown", planId, ...}}`
 *     — **UNSTABLE** (לא ב-typed union של ה-SDK הזה; loose parsing).
 *   - `{sessionUpdate:"plan_removed", planId}` — **UNSTABLE**.
 *
 * reducePlan טהור: מקבל update גולמי (unknown), מחזיר PlanStore חדש (immutable) —
 * $state ב-agent-session.svelte.ts מזהה את ההחלפה (ר' brief §6, Svelte-5 reactivity).
 * הקשחה: update/entry לא-תקין → no-op (מחזיר את אותו state reference) / דילוג-פריט —
 * לעולם לא זורק.
 *
 * ─── slice plan-todo-list Commit 0 (TDD) ───
 */
import { type } from "arktype"

export const PlanEntryStatus = type("'pending' | 'in_progress' | 'completed'")
export type PlanEntryStatus = typeof PlanEntryStatus.infer

export const PlanEntryPriority = type("'high' | 'medium' | 'low'")
export type PlanEntryPriority = typeof PlanEntryPriority.infer

export const PlanEntry = type({
  content: "string",
  status: PlanEntryStatus,
  "priority?": PlanEntryPriority, // codex/claude שולחים priority; נשאר אופציונלי להקשחה
})
export type PlanEntry = typeof PlanEntry.infer

/** מצב פנימי: מפה של תוכניות לפי planId. snapshot היציב (בלי planId) → planId="__default__". */
export type PlanItem =
  | { kind: "entries"; entries: PlanEntry[] }
  | { kind: "markdown"; content: string }
  | { kind: "file"; uri: string }
export type PlanStore = { order: string[]; byId: Record<string, PlanItem> }

export const EMPTY_PLAN_STORE: PlanStore = { order: [], byId: {} }

export const DEFAULT_PLAN_ID = "__default__"

/** מוסיף/מחליף item תחת id — replace מלא (לא merge). order מוסיף רק אם id חדש. */
function upsert(state: PlanStore, id: string, item: PlanItem): PlanStore {
  const order = state.order.includes(id) ? state.order : [...state.order, id]
  return { order, byId: { ...state.byId, [id]: item } }
}

function remove(state: PlanStore, id: string): PlanStore {
  if (!(id in state.byId)) return state
  const byId = { ...state.byId }
  delete byId[id]
  return { order: state.order.filter((existing) => existing !== id), byId }
}

/**
 * מפרסר מערך entries גולמי דרך ArkType, בגישת skip-invalid-items (תואם
 * `x-deserialize-skip-invalid-items` ב-schema.json של ה-SDK): פריט פגום מדלג,
 * לא נזרק. `raw` שאינו מערך → undefined (no-op ברמת ה-caller).
 */
function parseEntries(raw: unknown): PlanEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const entries: PlanEntry[] = []
  for (const item of raw) {
    const validated = PlanEntry(item)
    if (!(validated instanceof type.errors)) entries.push(validated)
  }
  return entries
}

/**
 * reducePlan — טהור. מקבל update גולמי (loose), מחזיר PlanStore חדש (immutable).
 *  - "plan"         → מחליף לגמרי את __default__ ב-{kind:"entries", entries} (snapshot).
 *  - "plan_update"  → upsert לפי planId: PlanItems→entries, PlanMarkdown→markdown, PlanFile→file.
 *  - "plan_removed" → מסיר planId.
 *  - update לא-מוכר / entries לא-תקין → מחזיר state ללא שינוי (הקשחה, לא זריקה).
 */
export function reducePlan(state: PlanStore, update: unknown): PlanStore {
  if (typeof update !== "object" || update === null) return state
  const u = update as Record<string, unknown>

  if (u.sessionUpdate === "plan") {
    const entries = parseEntries(u.entries)
    if (entries === undefined) return state
    return upsert(state, DEFAULT_PLAN_ID, { kind: "entries", entries })
  }

  if (u.sessionUpdate === "plan_update") {
    if (typeof u.plan !== "object" || u.plan === null) return state
    const plan = u.plan as Record<string, unknown>
    const planId = typeof plan.planId === "string" ? plan.planId : undefined
    if (!planId) return state

    if (plan.type === "items") {
      const entries = parseEntries(plan.entries)
      if (entries === undefined) return state
      return upsert(state, planId, { kind: "entries", entries })
    }
    if (plan.type === "markdown") {
      if (typeof plan.content !== "string") return state
      return upsert(state, planId, { kind: "markdown", content: plan.content })
    }
    if (plan.type === "file") {
      if (typeof plan.uri !== "string") return state
      return upsert(state, planId, { kind: "file", uri: plan.uri })
    }
    return state
  }

  if (u.sessionUpdate === "plan_removed") {
    const planId = u.planId
    if (typeof planId !== "string") return state
    return remove(state, planId)
  }

  return state
}
