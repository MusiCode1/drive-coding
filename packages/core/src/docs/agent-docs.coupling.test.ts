import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CONFIG_SPECS } from "../config/specs.js"
import { CLI_KINDS } from "../schemas/agent.js"
import { MCP_TOOL_ALIASES, MCP_TOOL_META } from "../schemas/mcp-docs.js"
import { RPC_METHODS } from "../session/rpc-methods.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../..")
const LIFECYCLE_DOC = path.join(REPO_ROOT, "docs/agents/20-session-lifecycle.md")
const PROVIDERS_DOC = path.join(REPO_ROOT, "docs/agents/80-providers.md")
const RPC_DOC = path.join(REPO_ROOT, "docs/agents/50-rpc.md")
const UI_REFERENCE_DOC = path.join(REPO_ROOT, "docs/agents/46-ui-reference.md")
const ROUTES_ROOT = path.join(REPO_ROOT, "packages/frontend/src/routes")

describe("agent-docs coupling", () => {
  it("declares every MCP alias under its public owner and keeps the legacy example", () => {
    const lifecycle = fs.readFileSync(LIFECYCLE_DOC, "utf8")
    const owners = {
      "20-session-lifecycle.md": [
        "list",
        "open",
        "send",
        "state",
        "close",
        "note_set",
        "field_set",
        "field_delete",
      ],
      "60-identity-and-scopes.md": ["whoami"],
      "70-subagents.md": ["subscribe", "surface"],
    }
    for (const [doc, suffixes] of Object.entries(owners)) {
      const frontmatter = fs
        .readFileSync(path.join(REPO_ROOT, "docs/agents", doc), "utf8")
        .split("---")[1]
      for (const suffix of suffixes) {
        expect(frontmatter).toContain(`  - session_${suffix}\n`)
        expect(frontmatter).toContain(`  - agent_${suffix}\n`)
      }
    }
    for (const [legacy, alias] of Object.entries(MCP_TOOL_ALIASES)) {
      expect(lifecycle).toContain(`| \`${legacy}\` | \`${alias}\` |`)
    }
    const example = lifecycle.split("Example workflow inputs")[1]?.split("```")[1]
    expect(example).toMatch(/^session_open\s+\{"cli":.*"cwd":/m)
    expect(example).toMatch(/^session_send\s+\{"agent":.*"sets":/m)
    expect(example).toMatch(/^session_close\s+\{"agent":/m)
  })

  it("20-session-lifecycle stays aligned with MCP lifecycle tools and owner TTL env", () => {
    const doc = fs.readFileSync(LIFECYCLE_DOC, "utf8")
    const LIFECYCLE = ["session_open", "session_send", "session_state", "session_close"]
    const names = Object.keys(MCP_TOOL_META).filter((k) => LIFECYCLE.includes(k))
    expect(names).toHaveLength(4)
    for (const n of names) {
      expect(doc).toContain(n)
    }
    const ttlEnv = CONFIG_SPECS.find((s) => s.key === "httpOwnerTtlMs")?.env
    if (ttlEnv === undefined) throw new Error("httpOwnerTtlMs spec lost its env key")
    expect(doc).toContain(ttlEnv)
  })

  it("unsubscribe is documented and discoverable in the three agent docs", () => {
    expect(MCP_TOOL_META.agent_unsubscribe?.description).toContain("effective subscriber")
    for (const name of ["60-identity-and-scopes", "70-subagents", "97-transports"]) {
      const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/agents", `${name}.md`), "utf8")
      const delimiter = "\n---\n"
      const end = doc.indexOf(delimiter)
      expect(end).toBeGreaterThan(0)
      const frontmatter = doc.slice(0, end)
      const prose = doc.slice(end + delimiter.length)
      expect(frontmatter).toMatch(/^ {2}- agent_unsubscribe$/m)
      expect(frontmatter).toMatch(/^ {2}- DELETE \/api\/agents\/:id\/subscribe$/m)
      expect(prose).toContain("`agent_unsubscribe")
      expect(prose).toContain("`DELETE /api/agents/:id/subscribe`")
    }
  })

  it("agent_cancel is discoverable in the lifecycle, state, scope and RPC docs", () => {
    expect(MCP_TOOL_META.agent_cancel?.description).toContain("session/cancel")
    for (const name of [
      "20-session-lifecycle",
      "40-reading-output",
      "50-rpc",
      "60-identity-and-scopes",
    ]) {
      const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/agents", `${name}.md`), "utf8")
      const delimiter = "\n---\n"
      const end = doc.indexOf(delimiter)
      expect(end).toBeGreaterThan(0)
      expect(doc.slice(0, end)).toMatch(
        /^ {2}- agent_cancel$|^mcp_tools: \[.*\bagent_cancel\b.*\]$/m,
      )
      expect(doc.slice(end + delimiter.length)).toContain("`agent_cancel")
    }
  })

  it("80-providers lists every CLI_KINDS entry", () => {
    const doc = fs.readFileSync(PROVIDERS_DOC, "utf8")
    const kinds = [...CLI_KINDS]
    expect(kinds.length).toBeGreaterThan(0)
    for (const kind of kinds) {
      expect(doc).toContain(kind)
    }
    expect(kinds).toHaveLength(7)
  })

  it("50-rpc lists every RPC_METHODS canonical string", () => {
    const doc = fs.readFileSync(RPC_DOC, "utf8")
    const methods = Object.values(RPC_METHODS)
    expect(methods).toHaveLength(10)
    for (const name of methods) {
      expect(doc).toContain(name)
    }
  })

  it("46-ui-reference route paths exist as frontend route files", () => {
    const doc = fs.readFileSync(UI_REFERENCE_DOC, "utf8")
    const coupled = [
      { pathToken: "`/`", file: "+page.svelte" },
      {
        pathToken: "`/chat/<cliKind>/<sessionId>`",
        file: path.join("chat", "[cliKind]", "[sessionId]", "+page.svelte"),
      },
      { pathToken: "`/settings`", file: path.join("settings", "+page.svelte") },
      { pathToken: "`/usage`", file: path.join("usage", "+page.svelte") },
    ]
    expect(coupled).toHaveLength(4)
    for (const { pathToken, file } of coupled) {
      expect(doc).toContain(pathToken)
      expect(fs.existsSync(path.join(ROUTES_ROOT, file)), `missing ${file}`).toBe(true)
    }
  })
})
