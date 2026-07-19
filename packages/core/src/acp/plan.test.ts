/**
 * plan.test.ts — TDD unit ל-reducePlan (Commit 0).
 *
 * ‏מכסה: DoD #3-5 בבריף — snapshot replace, incremental (plan_update/plan_removed),
 * הקשחה מול update פגום.
 * ‏shape מאומת מול @agentclientprotocol/sdk schema.json (מותקן) — ר' plan.ts header.
 *
 * ─── slice plan-todo-list Commit 0 ───
 */
import { describe, expect, it } from "vitest"
import { DEFAULT_PLAN_ID, EMPTY_PLAN_STORE, type PlanStore, reducePlan } from "./plan.js"

describe("reducePlan — plan (snapshot)", () => {
  it("plan snapshot מאכלס את __default__ עם kind:entries", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan",
      entries: [{ content: "step 1", status: "pending", priority: "high" }],
    })
    expect(result.order).toEqual([DEFAULT_PLAN_ID])
    expect(result.byId[DEFAULT_PLAN_ID]).toEqual({
      kind: "entries",
      entries: [{ content: "step 1", status: "pending", priority: "high" }],
    })
  })

  it("priority אופציונלי — entry בלי priority תקין", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan",
      entries: [{ content: "step 1", status: "in_progress" }],
    })
    expect(result.byId[DEFAULT_PLAN_ID]).toEqual({
      kind: "entries",
      entries: [{ content: "step 1", status: "in_progress" }],
    })
  })

  it("שני plan snapshots רצופים → השני מנצח (replace, לא merge)", () => {
    const first = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan",
      entries: [
        { content: "step 1", status: "pending" },
        { content: "step 2", status: "pending" },
      ],
    })
    const second = reducePlan(first, {
      sessionUpdate: "plan",
      entries: [{ content: "step 1", status: "completed" }],
    })
    expect(second.order).toEqual([DEFAULT_PLAN_ID])
    expect(second.byId[DEFAULT_PLAN_ID]).toEqual({
      kind: "entries",
      entries: [{ content: "step 1", status: "completed" }],
    })
  })

  it("מחזיר object חדש (immutable replace) — reference שונה מה-state הקודם", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan",
      entries: [{ content: "step 1", status: "pending" }],
    })
    expect(result).not.toBe(EMPTY_PLAN_STORE)
  })
})

describe("reducePlan — plan_update / plan_removed (incremental)", () => {
  it("plan_update עם type:items → upsert entries לפי planId", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        planId: "codex-1",
        entries: [{ content: "codex step", status: "pending" }],
      },
    })
    expect(result.order).toEqual(["codex-1"])
    expect(result.byId["codex-1"]).toEqual({
      kind: "entries",
      entries: [{ content: "codex step", status: "pending" }],
    })
  })

  it("plan_update עם type:markdown → upsert kind:markdown", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_update",
      plan: { type: "markdown", planId: "md-1", content: "# Plan\n- a\n- b" },
    })
    expect(result.byId["md-1"]).toEqual({ kind: "markdown", content: "# Plan\n- a\n- b" })
  })

  it("plan_update עם type:file → upsert kind:file", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_update",
      plan: { type: "file", planId: "file-1", uri: "file:///tmp/plan.md" },
    })
    expect(result.byId["file-1"]).toEqual({ kind: "file", uri: "file:///tmp/plan.md" })
  })

  it("plan_update + plan_update נוסף אותו planId → מחליף (לא מצטבר) ב-order", () => {
    const first = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "x", entries: [{ content: "a", status: "pending" }] },
    })
    const second = reducePlan(first, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "x", entries: [{ content: "a", status: "completed" }] },
    })
    expect(second.order).toEqual(["x"])
    expect(second.byId.x).toEqual({
      kind: "entries",
      entries: [{ content: "a", status: "completed" }],
    })
  })

  it("plan_update(planId=X) + plan_removed(X) → מוסר מ-order וב-byId", () => {
    const withPlan = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "codex-1", entries: [{ content: "a", status: "pending" }] },
    })
    const removed = reducePlan(withPlan, { sessionUpdate: "plan_removed", planId: "codex-1" })
    expect(removed.order).toEqual([])
    expect(removed.byId["codex-1"]).toBeUndefined()
  })

  it("plan_removed על planId לא-קיים → no-op (אין שינוי)", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_removed",
      planId: "ghost",
    })
    expect(result).toBe(EMPTY_PLAN_STORE)
  })

  it("plan ו-plan_update בו-זמנית (planIds שונים) חיים יחד ב-order", () => {
    const withSnapshot = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan",
      entries: [{ content: "claude step", status: "pending" }],
    })
    const withCodex = reducePlan(withSnapshot, {
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        planId: "codex-1",
        entries: [{ content: "codex step", status: "pending" }],
      },
    })
    expect(withCodex.order).toEqual([DEFAULT_PLAN_ID, "codex-1"])
  })
})

describe("reducePlan — הקשחה (update פגום → no-op / דילוג-פריט)", () => {
  it("sessionUpdate לא-מוכר → מחזיר את אותו state reference", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, { sessionUpdate: "tool_call", toolCallId: "x" })
    expect(result).toBe(EMPTY_PLAN_STORE)
  })

  it("update לא-אובייקט (null/string/number) → no-op", () => {
    expect(reducePlan(EMPTY_PLAN_STORE, null)).toBe(EMPTY_PLAN_STORE)
    expect(reducePlan(EMPTY_PLAN_STORE, "plan")).toBe(EMPTY_PLAN_STORE)
    expect(reducePlan(EMPTY_PLAN_STORE, 42)).toBe(EMPTY_PLAN_STORE)
  })

  it("plan עם entries חסר (לא מערך) → no-op", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, { sessionUpdate: "plan" })
    expect(result).toBe(EMPTY_PLAN_STORE)
  })

  it("plan עם entry פגום (status לא-חוקי) → הפריט מדולג, השאר נשמר", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan",
      entries: [
        { content: "valid", status: "pending" },
        { content: "invalid status", status: "bogus" },
        { content: "missing content field replaced" }, // אין status בכלל
      ],
    })
    expect(result.byId[DEFAULT_PLAN_ID]).toEqual({
      kind: "entries",
      entries: [{ content: "valid", status: "pending" }],
    })
  })

  it("plan_update בלי planId → no-op", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_update",
      plan: { type: "items", entries: [{ content: "a", status: "pending" }] },
    })
    expect(result).toBe(EMPTY_PLAN_STORE)
  })

  it("plan_update עם plan.type לא-מוכר → no-op", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, {
      sessionUpdate: "plan_update",
      plan: { type: "unknown-variant", planId: "x" },
    })
    expect(result).toBe(EMPTY_PLAN_STORE)
  })

  it("plan_removed בלי planId (לא string) → no-op", () => {
    const result = reducePlan(EMPTY_PLAN_STORE, { sessionUpdate: "plan_removed" })
    expect(result).toBe(EMPTY_PLAN_STORE)
  })
})

describe("EMPTY_PLAN_STORE / DEFAULT_PLAN_ID", () => {
  it("EMPTY_PLAN_STORE הוא { order: [], byId: {} }", () => {
    const empty: PlanStore = EMPTY_PLAN_STORE
    expect(empty).toEqual({ order: [], byId: {} })
  })

  it("DEFAULT_PLAN_ID === '__default__'", () => {
    expect(DEFAULT_PLAN_ID).toBe("__default__")
  })
})
