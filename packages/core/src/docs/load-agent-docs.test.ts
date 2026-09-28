import { describe, expect, it } from "vitest"
import { loadAgentDocs, type AgentDocFile, type DocsSource } from "./index.js"

function source(files: readonly AgentDocFile[]): DocsSource {
  return () => files
}

describe("loadAgentDocs", () => {
  it("returns .md documents from the source", () => {
    const docs = loadAgentDocs(
      source([
        { name: "00-orientation.md", text: "# hi" },
        { name: "20-session-lifecycle.md", text: "# session" },
      ]),
    )
    expect(docs).toHaveLength(2)
    expect(docs[0]?.name).toBe("00-orientation.md")
  })

  it("filters out files that are not .md", () => {
    const docs = loadAgentDocs(
      source([
        { name: "00-orientation.md", text: "# hi" },
        { name: "tags.json", text: "{}" },
        { name: "notes.txt", text: "nope" },
      ]),
    )
    expect(docs).toHaveLength(1)
    expect(docs[0]?.name).toBe("00-orientation.md")
  })

  it("returns an empty array when the source is empty", () => {
    expect(loadAgentDocs(source([]))).toEqual([])
  })

  it("does not return index.md", () => {
    const docs = loadAgentDocs(
      source([
        { name: "index.md", text: "# map\n\nno front matter" },
        { name: "00-orientation.md", text: "---\nid: x\n---\n" },
      ]),
    )
    expect(docs.map((d) => d.name)).toEqual(["00-orientation.md"])
  })
})
