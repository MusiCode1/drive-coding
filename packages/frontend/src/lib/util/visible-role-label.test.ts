import { describe, expect, it } from "vitest"
import { visibleRoleLabel } from "./visible-role-label"

describe("visibleRoleLabel (slice agent-role-label C3)", () => {
  it("returns the label when set", () => {
    expect(visibleRoleLabel("planner")).toBe("planner")
  })

  it("returns undefined for empty string", () => {
    expect(visibleRoleLabel("")).toBeUndefined()
  })

  it("returns undefined when absent", () => {
    expect(visibleRoleLabel(undefined)).toBeUndefined()
  })
})
