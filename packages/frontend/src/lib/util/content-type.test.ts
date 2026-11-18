import { describe, expect, it } from "vitest"
import { baseContentType, isRenderableText } from "./content-type"

describe("baseContentType", () => {
  it("strips parameters", () => {
    expect(baseContentType("text/markdown; charset=utf-8")).toBe("text/markdown")
  })

  it("passes a bare type through", () => {
    expect(baseContentType("application/pdf")).toBe("application/pdf")
  })

  it("trims whitespace and lowercases", () => {
    expect(baseContentType("  TEXT/Markdown ;charset=UTF-8")).toBe("text/markdown")
  })

  it("survives an empty header", () => {
    expect(baseContentType("")).toBe("")
  })

  it("handles a parameter without a space", () => {
    expect(baseContentType("text/plain;charset=utf-8")).toBe("text/plain")
  })
})

describe("isRenderableText", () => {
  it("🔴 the live bug — markdown WITH charset still renders as text", () => {
    expect(isRenderableText("text/markdown; charset=utf-8")).toBe(true)
  })

  it("bare markdown still renders as text", () => {
    expect(isRenderableText("text/markdown")).toBe(true)
  })

  it("octet-stream (a non-UTF-8 text file, downgraded by the BE) is NOT text", () => {
    expect(isRenderableText("application/octet-stream")).toBe(false)
  })

  it("images and pdf are not text", () => {
    expect(isRenderableText("image/png")).toBe(false)
    expect(isRenderableText("application/pdf")).toBe(false)
  })
})
