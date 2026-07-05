/**
 * permission.test.ts — TDD עבור טיפוסי permission ומיפוי טהור (Commit 0).
 *
 * מכסה (§5 DoD):
 *   1. mapping משתמש ב-option.name (לא option.label)
 *   2. selected/cancelled response shape נכון
 *   3. לא ממיין options — סדר נשמר כפי שהגיע
 *   4. לא ממציא option — רק מה שהגיע מה-agent
 *
 * Testing: tdd
 */

import { describe, expect, it } from "vitest"
import {
  type PermissionParams,
  permissionCancelled,
  permissionSelected,
  toPermissionOptionViews,
} from "./permission"

/** בונה PermissionParams מינימלי-תקף עם options נתונים (שאר השדות לא רלוונטיים למיפוי). */
function makeParams(options: { optionId: string; name: string; kind: string }[]): PermissionParams {
  return {
    sessionId: "sess-1",
    toolCall: { toolCallId: "tc-1" },
    options,
  } as unknown as PermissionParams
}

describe("toPermissionOptionViews", () => {
  it("ממפה option.name (לא option.label) ל-name של ה-view", () => {
    const params = makeParams([{ optionId: "opt-1", name: "Allow once", kind: "allow_once" }])
    const views = toPermissionOptionViews(params)
    expect(views).toEqual([{ optionId: "opt-1", name: "Allow once", kind: "allow_once" }])
  })

  it("שומר את סדר ה-options כפי שהגיע — לא ממיין", () => {
    const params = makeParams([
      { optionId: "opt-c", name: "C", kind: "reject_once" },
      { optionId: "opt-a", name: "A", kind: "allow_once" },
      { optionId: "opt-b", name: "B", kind: "allow_always" },
    ])
    const views = toPermissionOptionViews(params)
    expect(views.map((v) => v.optionId)).toEqual(["opt-c", "opt-a", "opt-b"])
  })

  it("לא ממציא options — מספר ה-views תואם בדיוק למספר ה-options שהגיעו", () => {
    const params = makeParams([{ optionId: "opt-1", name: "Only one", kind: "allow_once" }])
    const views = toPermissionOptionViews(params)
    expect(views).toHaveLength(1)
  })

  it("מעביר kind לא-מוכר כפי שהוא (string) בלי לקרוס", () => {
    const params = makeParams([{ optionId: "opt-x", name: "Weird", kind: "some_future_kind" }])
    const views = toPermissionOptionViews(params)
    expect(views[0]).toEqual({ optionId: "opt-x", name: "Weird", kind: "some_future_kind" })
  })

  it("מטפל ברשימת options ריקה", () => {
    const params = makeParams([])
    expect(toPermissionOptionViews(params)).toEqual([])
  })
})

describe("permissionSelected", () => {
  it("מחזיר outcome selected עם optionId נתון", () => {
    expect(permissionSelected("opt-1")).toEqual({
      outcome: { outcome: "selected", optionId: "opt-1" },
    })
  })
})

describe("permissionCancelled", () => {
  it("מחזיר outcome cancelled", () => {
    expect(permissionCancelled()).toEqual({ outcome: { outcome: "cancelled" } })
  })
})
