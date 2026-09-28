import { describe, expect, it } from "vitest"
import { createBinaryDocsSource } from "./docs-source.js"

describe("createBinaryDocsSource", () => {
  it("returns an empty array when the committed stub has no entries", () => {
    expect(createBinaryDocsSource()()).toEqual([])
  })
})
