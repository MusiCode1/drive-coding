import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")

describe("agent-api gate helpers", () => {
  it("parses thirteen McpToolName union members from mcp-docs.ts", async () => {
    const { mcpToolVocabulary } = await import(
      // @ts-expect-error — gate scripts are Node ESM outside the TS program
      "../../../../scripts/lint-agent-docs.mjs"
    )
    const names = mcpToolVocabulary(REPO_ROOT)
    expect(names).toHaveLength(13)
    expect(names).toContain("notify_parent")
    expect(names).toContain("session_open")
  })

  it("documentableRouteKeys includes GET /api/health and excludes GET /*", async () => {
    const { documentableRouteKeys } = await import(
      // @ts-expect-error — gate scripts are Node ESM outside the TS program
      "../../../../scripts/lint-agent-docs.mjs"
    )
    const keys = documentableRouteKeys(REPO_ROOT)
    expect(keys.has("get /api/health")).toBe(true)
    expect(keys.has("get /*")).toBe(false)
    expect(keys.size).toBe(39)
  })
})
