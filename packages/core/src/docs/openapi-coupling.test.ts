import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { RPC_METHODS } from "../session/rpc-methods.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const RPC_DOC = path.join(REPO_ROOT, "docs/agents/50-rpc.md")
const OPENAPI = path.join(REPO_ROOT, "docs/agents/openapi.json")
const MCP_DOCS = path.join(REPO_ROOT, "packages/core/src/schemas/mcp-docs.ts")

function mcpToolNamesFromSource() {
  const text = fs.readFileSync(MCP_DOCS, "utf8")
  const start = text.indexOf("export type McpToolName")
  const tail = text.slice(start)
  const end = tail.search(/\nexport (const|type|function)/)
  const block = end === -1 ? tail : tail.slice(0, end)
  return [...block.matchAll(/\|\s*"([^"]+)"/g)].map((m) => m[1])
}

describe("openapi and RPC doc coupling", () => {
  it("50-rpc.md documents every canonical RPC_METHODS value exactly once in the table", () => {
    const doc = fs.readFileSync(RPC_DOC, "utf8")
    const methods = Object.values(RPC_METHODS)
    expect(methods).toHaveLength(10)
    for (const m of methods) {
      expect(doc).toContain(`\`${m}\``)
    }
    const mentioned = methods.filter((m) => doc.includes(`\`${m}\``))
    expect(mentioned).toHaveLength(10)
  })

  it("openapi.json carries 36 HTTP operations", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8")) as {
      paths?: Record<string, Record<string, unknown>>
    }
    const ops = Object.values(spec.paths ?? {}).flatMap((item) =>
      Object.keys(item).filter((k) => !k.startsWith("x-") && k !== "parameters"),
    )
    expect(ops).toHaveLength(36)
  })

  it("McpToolName union has twelve members (includes notify_parent)", () => {
    const names = mcpToolNamesFromSource()
    expect(names).toHaveLength(12)
    expect(names).toContain("notify_parent")
  })

  it("POST reply and POST rpc request bodies are marked x-drive-coding-contract none", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8"))
    const reply =
      spec.paths["/api/agents/:id/reply"]?.post?.requestBody?.content?.["application/json"]
    const rpc =
      spec.paths["/api/agents/:id/rpc"]?.post?.requestBody?.content?.["application/json"]
    expect(reply?.["x-drive-coding-contract"]).toBe("none")
    expect(rpc?.["x-drive-coding-contract"]).toBe("none")
    expect(spec.paths["/api/agents/:id/reply"]?.post?.description).toContain(
      "No runtime schema validates",
    )
  })
})
