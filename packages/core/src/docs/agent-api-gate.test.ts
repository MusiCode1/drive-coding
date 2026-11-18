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
    // 41 since 261db514 (13/10/2026): GET + PATCH /api/scope-policy
    expect(keys.size).toBe(41)
  })
})
