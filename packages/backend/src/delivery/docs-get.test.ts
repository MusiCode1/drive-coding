import { describe, expect, it } from "vitest"
import { docsGetFromInput } from "./docs-mcp.js"

function idsFromResult(result: ReturnType<typeof docsGetFromInput>): string[] {
  if ("isError" in result && result.isError) return []
  const body = JSON.parse(result.content[0]!.text) as { docs?: Array<{ id: string }> }
  return (body.docs ?? []).map((d) => d.id)
}

describe("docs_get input modes", () => {
  it("tags render → render-contract only; unknown tag → empty", () => {
    const hit = docsGetFromInput({ tags: ["render"] })
    expect(idsFromResult(hit)).toEqual(["render-contract"])
    const miss = docsGetFromInput({ tags: ["no-such-tag-xyz"] })
    const missBody = JSON.parse(miss.content[0]!.text) as { docs: unknown[] }
    expect(missBody.docs).toHaveLength(0)
  })

  it("query mcp matches eight docs across fields (not id-only)", () => {
    const hit = docsGetFromInput({ query: "mcp" })
    expect([...idsFromResult(hit)].sort()).toEqual([
      "child-config",
      "connect",
      "errors",
      "orientation",
      "reading-output",
      "rpc",
      "session-lifecycle",
      "transports",
    ])
  })

  it("nonsense query → empty", () => {
    const miss = docsGetFromInput({ query: "zzz-no-such-xyz" })
    const missBody = JSON.parse(miss.content[0]!.text) as { docs: unknown[] }
    expect(missBody.docs).toHaveLength(0)
  })

  it("unknown id → isError", () => {
    const result = docsGetFromInput({ id: "no-such-doc" })
    expect("isError" in result && result.isError).toBe(true)
  })

  it("empty input → full index (17 docs)", () => {
    const result = docsGetFromInput({})
    const body = JSON.parse(result.content[0]!.text) as { docs: unknown[] }
    expect(body.docs).toHaveLength(17)
  })
})
