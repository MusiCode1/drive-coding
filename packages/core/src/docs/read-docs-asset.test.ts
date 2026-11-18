import { describe, expect, it } from "vitest"
import { type AgentDocFile, readDocsAsset } from "./index.js"

describe("readDocsAsset", () => {
  const files: readonly AgentDocFile[] = [
    { name: "index.json", text: '{"docs":[]}' },
    { name: "00-orientation.md", text: "# hi" },
  ]

  it("returns text for a matching asset name", () => {
    expect(readDocsAsset(files, "index.json")).toBe('{"docs":[]}')
  })

  it("returns undefined when the name is missing", () => {
    expect(readDocsAsset(files, "openapi.json")).toBeUndefined()
  })
})
