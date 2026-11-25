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

  it("openapi.json carries 43 HTTP operations", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8")) as {
      paths?: Record<string, Record<string, unknown>>
    }
    const ops = Object.values(spec.paths ?? {}).flatMap((item) =>
      Object.keys(item).filter((k) => !k.startsWith("x-") && k !== "parameters"),
    )
    expect(ops).toHaveLength(43)
  })

  it("McpToolName union includes both agent-event tools and notify_parent", () => {
    const names = mcpToolNamesFromSource()
    expect(names).toHaveLength(14)
    expect(names).toEqual(
      expect.arrayContaining(["notify_parent", "session_subscribe", "agent_unsubscribe"]),
    )
  })

  it("openapi.json status codes match agent HTTP handlers for core operations", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8")) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>
    }
    const keys = (method: string, path: string) =>
      Object.keys(spec.paths[path]?.[method]?.responses ?? {}).sort()

    expect(keys("post", "/api/agents/:id/rpc")).toEqual(["200", "202", "400", "401", "404", "409"])
    expect(keys("post", "/api/agents/:id/subscribe")).toEqual(["204", "400", "403", "404"])
    expect(keys("delete", "/api/agents/:id/subscribe")).toEqual(["204", "400", "403"])
    expect(keys("post", "/api/agents")).toEqual(["201", "400", "403", "500"])
    expect(keys("delete", "/api/agents/:id")).toEqual(["204", "404"])
  })

  it("DELETE subscribe resolves to a required subscriber UUID with no other fields", () => {
    const spec = JSON.parse(fs.readFileSync(OPENAPI, "utf8"))
    const requestBody = spec.paths["/api/agents/:id/subscribe"]?.delete?.requestBody
    expect(requestBody?.required).toBe(true)
    const ref = requestBody?.content?.["application/json"]?.schema?.$ref
    expect(ref).toBe("#/components/schemas/AgentUnsubscribeBody")
    const component = spec.components.schemas[ref.split("/").at(-1)]
    expect(component).toMatchObject({
      additionalProperties: false,
      required: ["subscriberAgentId"],
      properties: { subscriberAgentId: { format: "uuid" } },
    })
    expect(Object.keys(component.properties)).toEqual(["subscriberAgentId"])
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
