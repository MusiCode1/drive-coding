import { describe, expect, it } from "vitest"
import { classifyToolKind } from "../../src/provider/tool-kind"
import type { ToolKind } from "../../src/provider/events"

describe("classifyToolKind", () => {
  // כל 10 ערכי ACP
  it("maps read → read", () => {
    const result: ToolKind = classifyToolKind("read")
    expect(result).toBe("read")
  })

  it("maps edit → edit", () => {
    expect(classifyToolKind("edit")).toBe("edit")
  })

  it("maps delete → edit (מוטציית-קובץ, §9 #2)", () => {
    expect(classifyToolKind("delete")).toBe("edit")
  })

  it("maps move → edit (מוטציית-קובץ, §9 #2)", () => {
    expect(classifyToolKind("move")).toBe("edit")
  })

  it("maps execute → execute", () => {
    expect(classifyToolKind("execute")).toBe("execute")
  })

  it("maps search → search", () => {
    expect(classifyToolKind("search")).toBe("search")
  })

  it("maps fetch → fetch", () => {
    expect(classifyToolKind("fetch")).toBe("fetch")
  })

  it("maps think → think", () => {
    expect(classifyToolKind("think")).toBe("think")
  })

  it("maps switch_mode → other", () => {
    expect(classifyToolKind("switch_mode")).toBe("other")
  })

  it("maps other → other", () => {
    expect(classifyToolKind("other")).toBe("other")
  })

  // ערך לא-מוכר
  it("maps unknown value → other (default)", () => {
    expect(classifyToolKind("totally_unknown_kind")).toBe("other")
  })

  // ווידוא שכל הערכים מחזירים ToolKind ודאי (לא undefined)
  it("never returns undefined for any input", () => {
    const inputs = ["read", "edit", "delete", "move", "execute", "search", "fetch", "think", "switch_mode", "other", "xyz"]
    for (const input of inputs) {
      const result = classifyToolKind(input)
      expect(result).toBeDefined()
      expect(typeof result).toBe("string")
    }
  })
})
