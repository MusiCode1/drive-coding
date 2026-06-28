import { describe, it, expect } from "vitest"
import { basename } from "./path"

describe("basename", () => {
  it("1. unix path — מחזיר רכיב אחרון", () => {
    expect(basename("/home/u/proj")).toBe("proj")
  })

  it("2. windows path — מחזיר רכיב אחרון", () => {
    expect(basename("D:\\Users\\u\\proj")).toBe("proj")
  })

  it("3. לוכסן סוגר — מסיר ומחזיר רכיב לפני הסוגר", () => {
    expect(basename("/a/b/")).toBe("b")
    expect(basename("C:\\a\\b\\")).toBe("b")
  })

  it("4. שם בלבד ללא מפריד — מוחזר כמו שהוא", () => {
    expect(basename("proj")).toBe("proj")
  })

  it("5. ריק — מוחזר ריק", () => {
    expect(basename("")).toBe("")
  })

  it("6. מעורב / ו-\\ — מחזיר רכיב אחרון", () => {
    expect(basename("C:\\a/b\\c")).toBe("c")
  })

  it("7. root / דרייב חשוף — נועל התנהגות (fallback ל-path המלא)", () => {
    expect(basename("/")).toBe("/")
    expect(basename("C:\\")).toBe("C:")
  })
})
