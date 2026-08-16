/**
 * permission.test.ts — TDD: מיפוי `PermissionParams.options` → view-model לרינדור.
 *
 * Tests:
 *   1. name/optionId/kind נשמרים כמו-שהם לכל אפשרות.
 *   2. מיון: allow (allow_once/allow_always) לפני reject (reject_once/reject_always).
 *   3. מיון בתוך allow: allow_once לפני allow_always.
 *   4. defaultPermissionOptionId → allow_once אם קיים.
 *   5. defaultPermissionOptionId → fallback לאפשרות הראשונה אם אין allow_once.
 *   6. אין אפשרויות → מערך ריק, default = undefined.
 */

import { describe, expect, it } from "vitest"
import {
  defaultPermissionOptionId,
  mapPermissionOptions,
  type PermissionParams,
} from "./permission.js"

function paramsWithOptions(options: PermissionParams["options"]): PermissionParams {
  return {
    sessionId: "s1",
    toolCall: { toolCallId: "t1", title: "Write file" },
    options,
  } as PermissionParams
}

describe("mapPermissionOptions", () => {
  it("1. name/optionId/kind נשמרים כמו-שהם", () => {
    const params = paramsWithOptions([{ optionId: "o1", name: "Allow once", kind: "allow_once" }])
    expect(mapPermissionOptions(params)).toEqual([
      { optionId: "o1", name: "Allow once", kind: "allow_once" },
    ])
  })

  it("2. מיון: allow לפני reject", () => {
    const params = paramsWithOptions([
      { optionId: "r1", name: "Reject", kind: "reject_once" },
      { optionId: "a1", name: "Allow", kind: "allow_once" },
    ])
    const result = mapPermissionOptions(params)
    expect(result.map((o) => o.optionId)).toEqual(["a1", "r1"])
  })

  it("3. מיון בתוך allow: allow_once לפני allow_always", () => {
    const params = paramsWithOptions([
      { optionId: "aa1", name: "Allow always", kind: "allow_always" },
      { optionId: "ao1", name: "Allow once", kind: "allow_once" },
    ])
    const result = mapPermissionOptions(params)
    expect(result.map((o) => o.optionId)).toEqual(["ao1", "aa1"])
  })

  it("3b. מיון בתוך reject: reject_once לפני reject_always", () => {
    const params = paramsWithOptions([
      { optionId: "ra1", name: "Reject always", kind: "reject_always" },
      { optionId: "ro1", name: "Reject once", kind: "reject_once" },
    ])
    const result = mapPermissionOptions(params)
    expect(result.map((o) => o.optionId)).toEqual(["ro1", "ra1"])
  })

  it("6. אין אפשרויות → מערך ריק", () => {
    const params = paramsWithOptions([])
    expect(mapPermissionOptions(params)).toEqual([])
  })
})

describe("defaultPermissionOptionId", () => {
  it("4. allow_once אם קיים", () => {
    const options = mapPermissionOptions(
      paramsWithOptions([
        { optionId: "r1", name: "Reject", kind: "reject_once" },
        { optionId: "ao1", name: "Allow once", kind: "allow_once" },
        { optionId: "aa1", name: "Allow always", kind: "allow_always" },
      ]),
    )
    expect(defaultPermissionOptionId(options)).toBe("ao1")
  })

  it("5. fallback לאפשרות הראשונה (אחרי מיון) אם אין allow_once", () => {
    const options = mapPermissionOptions(
      paramsWithOptions([
        { optionId: "r1", name: "Reject", kind: "reject_once" },
        { optionId: "aa1", name: "Allow always", kind: "allow_always" },
      ]),
    )
    expect(defaultPermissionOptionId(options)).toBe("aa1")
  })

  it("6b. מערך ריק → undefined", () => {
    expect(defaultPermissionOptionId([])).toBeUndefined()
  })
})
