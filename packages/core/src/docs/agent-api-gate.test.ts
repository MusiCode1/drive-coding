import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MCP_TOOL_ALIASES, MCP_TOOL_META } from "../schemas/mcp-docs.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")

describe("agent-api gate helpers", () => {
  it("parses the full MCP vocabulary and checks catalog metadata", async () => {
    const { mcpToolVocabulary } = await import(
      // @ts-expect-error — gate scripts are Node ESM outside the TS program
      "../../../../scripts/lint-agent-docs.mjs"
    )
    const names = mcpToolVocabulary(REPO_ROOT)
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
    const expectedPairs = suffixes.map((name) => [`session_${name}`, `agent_${name}`])
    const expectedMetadata = [
      "agent_cancel",
      "agent_unsubscribe",
      "docs_get",
      ...expectedPairs.flat(),
    ].sort()
    expect(names.sort()).toEqual([...expectedMetadata, "notify_parent"].sort())
    expect(Object.keys(MCP_TOOL_META).sort()).toEqual(expectedMetadata)
    expect(MCP_TOOL_ALIASES).toEqual(Object.fromEntries(expectedPairs))
  })

  it("parses the six _drive/* extensions from the extMethods registry", async () => {
    const { extMethodNamesFromText, EXT_METHODS_PATH } = await import(
      // @ts-expect-error — gate scripts are Node ESM outside the TS program
      "../../../../scripts/agent-docs-lib.mjs"
    )
    const fs = await import("node:fs")
    const names = extMethodNamesFromText(
      fs.readFileSync(path.join(REPO_ROOT, EXT_METHODS_PATH), "utf8"),
    )
    expect(names).toEqual([
      "_drive/setThinkingTokens",
      "_drive/getQuota",
      "_drive/voice/start",
      "_drive/voice/stop",
      "_drive/voice/listVoices",
      "_drive/voice/speak",
    ])
  })

  it("documentableRouteKeys includes GET /api/health and excludes GET /*", async () => {
    const { documentableRouteKeys } = await import(
      // @ts-expect-error — gate scripts are Node ESM outside the TS program
      "../../../../scripts/lint-agent-docs.mjs"
    )
    const keys = documentableRouteKeys(REPO_ROOT)
    expect(keys.has("get /api/health")).toBe(true)
    expect(keys.has("get /*")).toBe(false)
    // 44 after adding DELETE /api/recordings/:id
    expect(keys.size).toBe(44)
  })
})
