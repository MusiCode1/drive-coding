/**
 * permission.test.ts — TDD: permission types + resolvePermissionPolicy (slice session-create-contract C0).
 */

import { describe, expect, it } from "vitest"
import {
  defaultPermissionOptionId,
  mapPermissionOptions,
  type PermissionParams,
  resolvePermissionPolicy,
} from "../src/types/permission.js"

function paramsWithOptions(options: PermissionParams["options"]): PermissionParams {
  return {
    sessionId: "s1",
    toolCall: { toolCallId: "t1", title: "Write file" },
    options,
  } as PermissionParams
}

describe("mapPermissionOptions", () => {
  it("name/optionId/kind preserved as-is", () => {
    const params = paramsWithOptions([{ optionId: "o1", name: "Allow once", kind: "allow_once" }])
    expect(mapPermissionOptions(params)).toEqual([
      { optionId: "o1", name: "Allow once", kind: "allow_once" },
    ])
  })

  it("sort: allow before reject", () => {
    const params = paramsWithOptions([
      { optionId: "r1", name: "Reject", kind: "reject_once" },
      { optionId: "a1", name: "Allow", kind: "allow_once" },
    ])
    expect(mapPermissionOptions(params).map((o) => o.optionId)).toEqual(["a1", "r1"])
  })

  it("sort within allow: allow_once before allow_always", () => {
    const params = paramsWithOptions([
      { optionId: "aa1", name: "Allow always", kind: "allow_always" },
      { optionId: "ao1", name: "Allow once", kind: "allow_once" },
    ])
    expect(mapPermissionOptions(params).map((o) => o.optionId)).toEqual(["ao1", "aa1"])
  })

  it("empty options → empty array", () => {
    expect(mapPermissionOptions(paramsWithOptions([]))).toEqual([])
  })
})

describe("defaultPermissionOptionId", () => {
  it("prefers allow_once when present", () => {
    const options = mapPermissionOptions(
      paramsWithOptions([
        { optionId: "r1", name: "Reject", kind: "reject_once" },
        { optionId: "ao1", name: "Allow once", kind: "allow_once" },
        { optionId: "aa1", name: "Allow always", kind: "allow_always" },
      ]),
    )
    expect(defaultPermissionOptionId(options)).toBe("ao1")
  })

  it("empty array → undefined", () => {
    expect(defaultPermissionOptionId([])).toBeUndefined()
  })
})

describe("resolvePermissionPolicy", () => {
  const options = [
    { optionId: "ao1", name: "Allow once", kind: "allow_once" as const },
    { optionId: "aa1", name: "Allow always", kind: "allow_always" as const },
    { optionId: "ro1", name: "Reject once", kind: "reject_once" as const },
  ]

  it("allow_once → selects matching option", () => {
    expect(resolvePermissionPolicy("allow_once", { options })).toEqual({
      outcome: { outcome: "selected", optionId: "ao1" },
    })
  })

  it("allow_always → selects matching option", () => {
    expect(resolvePermissionPolicy("allow_always", { options })).toEqual({
      outcome: { outcome: "selected", optionId: "aa1" },
    })
  })

  it("reject_once → selects matching option", () => {
    expect(resolvePermissionPolicy("reject_once", { options })).toEqual({
      outcome: { outcome: "selected", optionId: "ro1" },
    })
  })

  it("ask → null (fall through to pending)", () => {
    expect(resolvePermissionPolicy("ask", { options })).toBeNull()
  })

  it("undefined policy → null (today's behavior)", () => {
    expect(resolvePermissionPolicy(undefined, { options })).toBeNull()
  })

  it("kind not offered → null (fall through to pending)", () => {
    expect(
      resolvePermissionPolicy("reject_once", {
        options: [{ optionId: "ao1", name: "Allow once", kind: "allow_once" }],
      }),
    ).toBeNull()
  })

  it("empty options → null", () => {
    expect(resolvePermissionPolicy("allow_once", { options: [] })).toBeNull()
  })
})
