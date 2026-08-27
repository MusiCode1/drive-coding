import { describe, expect, it } from "vitest"
import {
  applyMenuSearchQuery,
  applyPathSelection,
  openFromArrow,
  shouldOpenOnFocus,
} from "./cwd-path-combo-logic"

describe("shouldOpenOnFocus", () => {
  it("true only when value is empty/whitespace", () => {
    expect(shouldOpenOnFocus("")).toBe(true)
    expect(shouldOpenOnFocus("   ")).toBe(true)
    expect(shouldOpenOnFocus("/home/u")).toBe(false)
  })
})

describe("openFromArrow", () => {
  it("resets query and opens", () => {
    expect(openFromArrow()).toEqual({ query: "", open: true })
  })
})

describe("applyMenuSearchQuery", () => {
  it("updates query without touching cwd value", () => {
    const cwd = "/existing/path"
    const next = applyMenuSearchQuery({ query: "", open: true }, "drive")
    expect(next.query).toBe("drive")
    expect(next.open).toBe(true)
    expect(cwd).toBe("/existing/path")
  })
})

describe("applyPathSelection", () => {
  it("sets value and closes menu", () => {
    expect(applyPathSelection("/picked/path")).toEqual({
      value: "/picked/path",
      state: { query: "", open: false },
    })
  })
})
