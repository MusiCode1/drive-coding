import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { RPC_METHODS } from "../session/rpc-methods.js"
import { DOCS_VERSION } from "./index.js"

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

  it("openapi.json carries 42 HTTP operations", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8")) as {
      paths?: Record<string, Record<string, unknown>>
    }
    const ops = Object.values(spec.paths ?? {}).flatMap((item) =>
      Object.keys(item).filter((k) => !k.startsWith("x-") && k !== "parameters"),
    )
    // 42 since fix-session-url-hijack C1: GET /api/sessions/:cliKind/:sessionId
    expect(ops).toHaveLength(42)
  })

  it("publishes both input spellings for POST and PATCH under the docs version", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8"))
    const post = spec.paths["/api/agents"].post
    const patch = spec.paths["/api/agents/:id"].patch
    expect(spec.info.version).toBe(DOCS_VERSION)
    expect(post.operationId).toBe("post_api_agents")
    expect(patch.operationId).toBe("patch_api_agents_id")
    expect(post.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/CreateAgentInputFull",
    )
    expect(patch.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/PatchAgentInput",
    )
    expect(Object.keys(post.responses).sort()).toEqual(["201", "400", "500"])
    expect(Object.keys(patch.responses)).toEqual(["200"])
    const create = spec.components.schemas.CreateAgentInputFull
    expect(create.properties.notifyOnDone).toMatchObject({ format: "uuid" })
    expect(create.properties.subscribeOnOpenAgentId).toEqual(create.properties.notifyOnDone)
    expect(create.required).not.toContain("subscribeOnOpenAgentId")
    const notes = spec.components.schemas.PatchAgentInput
    expect(notes.additionalProperties).toBe(false)
    expect(notes.properties.userNotes).toEqual({ type: "string" })
    expect(notes.properties.agentNotes).toEqual(notes.properties.userNotes)
    expect(notes.properties).not.toHaveProperty("agentFields")
  })

  it("keeps both MCP vocabularies and the two single-name tools", () => {
    const names = mcpToolNamesFromSource()
    const suffixes = [
      "list",
      "open",
      "send",
      "state",
      "close",
      "subscribe",
      "whoami",
      "surface",
      "note_set",
      "field_set",
      "field_delete",
    ]
    expect(names.sort()).toEqual(
      [
        "docs_get",
        "notify_parent",
        ...suffixes.flatMap((suffix) => [`agent_${suffix}`, `session_${suffix}`]),
      ].sort(),
    )
  })

  it("openapi.json status codes match agent HTTP handlers for four core operations", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8")) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>
    }
    const keys = (method: string, path: string) =>
      Object.keys(spec.paths[path]?.[method]?.responses ?? {}).sort()

    expect(keys("post", "/api/agents/:id/rpc")).toEqual(["200", "202", "400", "401", "404", "409"])
    expect(keys("post", "/api/agents/:id/subscribe")).toEqual(["204", "400", "404"])
    expect(keys("post", "/api/agents")).toEqual(["201", "400", "500"])
    expect(keys("delete", "/api/agents/:id")).toEqual(["204", "404"])
  })

  it("openapi.json status codes match agent docs HTTP handlers", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8")) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>
    }
    const keys = (method: string, path: string) =>
      Object.keys(spec.paths[path]?.[method]?.responses ?? {}).sort()

    expect(keys("get", "/api/docs")).toEqual(["200"])
    expect(keys("get", "/api/docs/:id")).toEqual(["200", "404"])
    expect(keys("get", "/api/openapi.json")).toEqual(["200"])
  })

  it("POST reply and POST rpc request bodies are marked x-drive-coding-contract none", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8"))
    const reply =
      spec.paths["/api/agents/:id/reply"]?.post?.requestBody?.content?.["application/json"]
    const rpc = spec.paths["/api/agents/:id/rpc"]?.post?.requestBody?.content?.["application/json"]
    expect(reply?.["x-drive-coding-contract"]).toBe("none")
    expect(rpc?.["x-drive-coding-contract"]).toBe("none")
    expect(spec.paths["/api/agents/:id/reply"]?.post?.description).toContain(
      "No runtime schema validates",
    )
  })
})
