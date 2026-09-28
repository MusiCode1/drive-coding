import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CONFIG_SPECS } from "../config/specs.js"
import { MCP_TOOL_META } from "../schemas/mcp-docs.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const LIFECYCLE_DOC = path.join(REPO_ROOT, "docs/agents/20-session-lifecycle.md")

describe("agent-docs coupling", () => {
  it("20-session-lifecycle stays aligned with MCP lifecycle tools and owner TTL env", () => {
    const doc = fs.readFileSync(LIFECYCLE_DOC, "utf8")
    const LIFECYCLE = ["session_open", "session_send", "session_state", "session_close"]
    const names = Object.keys(MCP_TOOL_META).filter((k) => LIFECYCLE.includes(k))
    expect(names).toHaveLength(4)
    for (const n of names) {
      expect(doc).toContain(n)
    }
    const ttlSpec = CONFIG_SPECS.find((s) => s.key === "httpOwnerTtlMs")
    expect(ttlSpec?.env).toBeDefined()
    expect(doc).toContain(ttlSpec!.env)
  })
})
