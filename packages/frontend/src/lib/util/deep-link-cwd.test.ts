import { describe, expect, it } from "vitest"
import { classifyDeepLinkCwd, joinHomeDir } from "./deep-link-cwd"

describe("classifyDeepLinkCwd", () => {
  it("Unix absolute", () => {
    expect(classifyDeepLinkCwd("/home/user/x")).toEqual({
      kind: "absolute",
      cwd: "/home/user/x",
    })
  })

  it("relative project path", () => {
    expect(classifyDeepLinkCwd("Projects/x")).toEqual({
      kind: "relative",
      relative: "Projects/x",
    })
  })

  it("./x and ../x are relative", () => {
    expect(classifyDeepLinkCwd("./x")).toEqual({ kind: "relative", relative: "./x" })
    expect(classifyDeepLinkCwd("../x")).toEqual({ kind: "relative", relative: "../x" })
  })

  it("Windows drive paths are absolute", () => {
    expect(classifyDeepLinkCwd("C:/x")).toEqual({ kind: "absolute", cwd: "C:/x" })
    expect(classifyDeepLinkCwd("C:\\x")).toEqual({ kind: "absolute", cwd: "C:\\x" })
  })

  it("Windows UNC is absolute", () => {
    expect(classifyDeepLinkCwd("\\\\srv\\share")).toEqual({
      kind: "absolute",
      cwd: "\\\\srv\\share",
    })
  })

  it("drive-relative C:x is relative", () => {
    expect(classifyDeepLinkCwd("C:x")).toEqual({ kind: "relative", relative: "C:x" })
  })

  it("null (no ?cwd) is empty", () => {
    expect(classifyDeepLinkCwd(null)).toEqual({ kind: "empty" })
  })

  it('"" (?cwd= with no value) is empty', () => {
    expect(classifyDeepLinkCwd("")).toEqual({ kind: "empty" })
  })

  it("whitespace-only and tab are empty", () => {
    expect(classifyDeepLinkCwd("   ")).toEqual({ kind: "empty" })
    expect(classifyDeepLinkCwd("\t")).toEqual({ kind: "empty" })
  })

  it("trim preserves inner path for relative", () => {
    expect(classifyDeepLinkCwd("  Projects/x  ")).toEqual({
      kind: "relative",
      relative: "Projects/x",
    })
  })

  it("trim preserves inner path for absolute", () => {
    expect(classifyDeepLinkCwd("  /home/u/x  ")).toEqual({
      kind: "absolute",
      cwd: "/home/u/x",
    })
  })
})

describe("joinHomeDir", () => {
  it("joins path segments", () => {
    expect(joinHomeDir("/home/u", "a/b")).toBe("/home/u/a/b")
  })

  it("strips trailing slash on homeDir", () => {
    expect(joinHomeDir("/home/u/", "a")).toBe("/home/u/a")
  })

  it("root homeDir", () => {
    expect(joinHomeDir("/", "a")).toBe("/a")
  })
})
