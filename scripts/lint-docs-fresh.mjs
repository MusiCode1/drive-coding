#!/usr/bin/env node
// lint-docs-fresh.mjs — range-based freshness gate for agent docs (fail-open).

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { listDocFiles, parseFrontMatter, readDoc } from "./agent-docs-lib.mjs"
import { compareSemver, parseSemver } from "./docs-version-semver.mjs"
import { PUBLISH_REAL_ISSUES } from "./gen-known-issues.mjs"
import { extractOperations } from "./lint-api-documented.mjs"

const OUT_OF_SCOPE = [
  ["get", "/*"],
  ["all", "/proxy/:provider/*"],
]

const ROUTE_LINE_RE =
  /\.(get|post|put|patch|delete|all|on)\(\s*["'`](\/[^"'`\n]*)["'`]/g

function matchRouteLines(line) {
  return [...line.matchAll(new RegExp(ROUTE_LINE_RE.source, "g"))]
}
const ROUTE_FM = /^(GET|POST|PUT|PATCH|DELETE) (\S+)$/
const RENDER_PATHS = [
  "packages/core/src/ui/markdown.ts",
  "packages/frontend/src/lib/util/markdown-image-src.ts",
]
const CONFIG_SPECS_PATH = "packages/core/src/config/specs.ts"
const MCP_DOCS_PATH = "packages/core/src/schemas/mcp-docs.ts"
const CORE_DOCS_PATH = "packages/core/src/docs/index.ts"
const KNOWN_ISSUES_PATH = "docs/agents/99-known-issues.md"
/** integration/run-agent-docs-serve tip — map checks clamp here (slice base). */
const AGENT_DOCS_INTEGRATION_BASE = "40aca861580f0b95d151579b2805d46a160b3502"

function mapCheckRange(root, base, head) {
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", base, AGENT_DOCS_INTEGRATION_BASE], {
      stdio: "ignore",
    })
    return `${AGENT_DOCS_INTEGRATION_BASE}..${head}`
  } catch {
    return `${base}..${head}`
  }
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trimEnd()
}

function gitShow(root, ref, filePath) {
  try {
    return execFileSync("git", ["-C", root, "show", `${ref}:${filePath}`], { encoding: "utf8" })
  } catch {
    return null
  }
}

function parseArgs(argv) {
  let root = process.cwd()
  let range = null
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i])
    } else if (argv[i] === "--range" && argv[i + 1]) {
      range = argv[++i]
    }
  }
  return { root, range }
}

function readStdinPushRef() {
  try {
    const st = fs.fstatSync(0)
    if (!st.isFIFO() && !st.isFile()) return null
    const text = fs.readFileSync(0, "utf8").trim()
    if (!text) return null
    const parts = text.split(/\s+/)
    if (parts.length < 4) return null
    const localSha = parts[1]
    const remoteSha = parts[3]
    if (!remoteSha || /^0+$/.test(remoteSha)) return null
    return { localSha, remoteSha }
  } catch {
    return null
  }
}

function resolveRange(root, explicit) {
  if (explicit) {
    const [base, head] = explicit.split("..")
    if (base && head) return { base, head: head === "HEAD" ? git(root, ["rev-parse", "HEAD"]) : head }
  }

  const push = readStdinPushRef()
  if (push) {
    try {
      execFileSync("git", ["-C", root, "cat-file", "-e", push.remoteSha], { stdio: "ignore" })
      return { base: push.remoteSha, head: push.localSha }
    } catch {
      /* fall through */
    }
  }

  try {
    const upstream = git(root, ["rev-parse", "--abbrev-ref", "@{u}"])
    if (upstream && upstream !== "@{u}") {
      const base = git(root, ["merge-base", "HEAD", upstream])
      const head = git(root, ["rev-parse", "HEAD"])
      return { base, head }
    }
  } catch {
    /* fall through */
  }

  try {
    const lines = git(root, ["rev-list", "HEAD", "--not", "--remotes=origin"]).split("\n").filter(Boolean)
    if (lines.length > 0) {
      const oldest = lines.at(-1)
      const base = git(root, ["rev-parse", `${oldest}^`])
      const head = git(root, ["rev-parse", "HEAD"])
      return { base, head }
    }
  } catch {
    /* fall through */
  }

  return null
}

function docsVersionFromText(text) {
  return text?.match(/DOCS_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? null
}

function mcpToolsFromText(text) {
  const start = text.indexOf("export type McpToolName")
  if (start === -1) return []
  const tail = text.slice(start)
  const end = tail.search(/\nexport (const|type|function)/)
  const block = end === -1 ? tail : tail.slice(0, end)
  return [...block.matchAll(/\|\s*"([^"]+)"/g)].map((m) => m[1])
}

function configKeysFromText(text) {
  return [...text.matchAll(/^\s*key:\s*"([^"]+)"/gm)].map((m) => m[1])
}

function documentableRouteKeys(root) {
  const backendSrc = path.join(root, "packages/backend/src")
  if (!fs.existsSync(backendSrc)) return new Set()
  const { operations } = extractOperations(root)
  return new Set(
    operations
      .filter((o) => !OUT_OF_SCOPE.some(([m, p]) => m === o.method && p === o.path))
      .map((o) => `${o.method} ${o.path}`),
  )
}

function openapiKeys(root) {
  const p = path.join(root, "docs/agents/openapi.json")
  const spec = JSON.parse(fs.readFileSync(p, "utf8"))
  const set = new Set()
  for (const [route, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (method !== "parameters" && !method.startsWith("x-")) set.add(`${method.toLowerCase()} ${route}`)
    }
  }
  return { version: spec.info?.version, keys: set }
}

function routeOwners(root) {
  const owners = new Map()
  for (const name of listDocFiles(root)) {
    const doc = readDoc(root, name)
    if (!doc.front.ok) continue
    const routes = doc.front.data.routes
    if (!Array.isArray(routes)) continue
    for (const r of routes) {
      const m = String(r).match(ROUTE_FM)
      if (m) owners.set(`${m[1].toLowerCase()} ${m[2]}`, doc.rel)
    }
  }
  return owners
}

function mcpToolOwners(root) {
  const owners = new Map()
  for (const name of listDocFiles(root)) {
    const doc = readDoc(root, name)
    if (!doc.front.ok) continue
    const tools = doc.front.data.mcp_tools
    if (!Array.isArray(tools)) continue
    for (const t of tools) owners.set(String(t), doc.rel)
  }
  return owners
}

function symmetricRouteDelta(root, range) {
  let diff
  try {
    diff = git(root, ["diff", range, "--", "packages/backend/src"])
  } catch {
    return []
  }
  const added = new Set()
  const removed = new Set()
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const m of matchRouteLines(line.slice(1))) added.add(`${m[1]} ${m[2]}`)
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      for (const m of matchRouteLines(line.slice(1))) removed.add(`${m[1]} ${m[2]}`)
    }
  }
  return [
    ...[...added].filter((k) => !removed.has(k)),
    ...[...removed].filter((k) => !added.has(k)),
  ]
}

function diffTouches(root, range, files) {
  try {
    const names = git(root, ["diff", "--name-only", range, "--", ...files])
    return names.length > 0
  } catch {
    return false
  }
}

function fePageAddsDeletes(root, range) {
  try {
    const out = git(root, ["diff", "--name-status", range, "--", "packages/frontend/src/routes"])
    return out
      .split("\n")
      .filter(Boolean)
      .filter((l) => /^[AD]\t.*\/\+page\.svelte$/.test(l))
      .map((l) => l.split("\t")[1])
  } catch {
    return []
  }
}

function changedAgentDocs(root, range) {
  try {
    return git(root, ["diff", "--name-only", range, "--", "docs/agents/*.md"])
      .split("\n")
      .filter(Boolean)
      .filter((p) => !p.endsWith("docs/agents/index.md"))
  } catch {
    return []
  }
}

function markedBugIds(root) {
  const ids = new Set()
  const bugsRoot = path.join(root, "docs-for-llm", "bugs")
  if (!fs.existsSync(bugsRoot)) return ids
  /** @param {string} dir */
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith(".md") && ent.name !== "README.md" && ent.name !== "_TEMPLATE.md") {
        const text = fs.readFileSync(p, "utf8")
        const parsed = parseFrontMatter(text)
        if (!parsed.ok) continue
        const summary = parsed.data.public_summary_en
        if (summary !== undefined && String(summary).trim() !== "" && parsed.data.id) {
          ids.add(String(parsed.data.id))
        }
      }
    }
  }
  walk(bugsRoot)
  return ids
}

function idsInKnownIssues(root) {
  const p = path.join(root, KNOWN_ISSUES_PATH)
  if (!fs.existsSync(p)) return new Set()
  const text = fs.readFileSync(p, "utf8")
  const ids = new Set()
  for (const m of text.matchAll(/\|\s*`(#[^`]+)`\s*\|/g)) ids.add(m[1])
  return ids
}

export function runFreshnessChecks(root, rangeSpec) {
  const fails = []
  const range = resolveRange(root, rangeSpec)
  if (!range) return { fails: [], skipped: true }

  const rangeStr = `${range.base}..${range.head}`
  const mapRangeStr = mapCheckRange(root, range.base, range.head)
  const headVersion = docsVersionFromText(fs.readFileSync(path.join(root, CORE_DOCS_PATH), "utf8"))
  const baseVersion = docsVersionFromText(gitShow(root, range.base, CORE_DOCS_PATH))

  const changedDocs = changedAgentDocs(root, rangeStr)
  if (changedDocs.length > 0) {
    if (!headVersion || !parseSemver(headVersion)) {
      fails.push(`${CORE_DOCS_PATH}: DOCS_VERSION at HEAD is missing or not semver`)
    } else if (baseVersion && parseSemver(baseVersion)) {
      if (compareSemver(headVersion, baseVersion) <= 0) {
        fails.push(
          `docs/agents/*.md: ${changedDocs.length} document(s) changed but DOCS_VERSION ${headVersion} is not greater than ${baseVersion}`,
        )
      }
    }
  }

  if (!fs.existsSync(path.join(root, "docs/agents/openapi.json"))) {
    return { fails, skipped: false, range: rangeStr }
  }
  const { version: openapiVersion, keys: openapiSet } = openapiKeys(root)
  const codeRoutes = documentableRouteKeys(root)
  for (const k of codeRoutes) {
    if (!openapiSet.has(k)) fails.push(`docs/agents/openapi.json: missing operation ${k}`)
  }
  for (const k of openapiSet) {
    if (!codeRoutes.has(k)) fails.push(`docs/agents/openapi.json: stale operation ${k}`)
  }
  if (headVersion && openapiVersion !== headVersion) {
    fails.push(
      `docs/agents/openapi.json: info.version ${JSON.stringify(openapiVersion)} != DOCS_VERSION ${JSON.stringify(headVersion)}`,
    )
  }

  const routeDelta = symmetricRouteDelta(root, mapRangeStr)
  const routeMap = routeOwners(root)
  for (const key of routeDelta) {
    if (!openapiSet.has(key)) {
      fails.push(`docs/agents/openapi.json: route registration changed but openapi missing ${key}`)
    }
    if (!routeMap.has(key)) {
      const [method, routePath] = key.split(" ")
      fails.push(`no document declares ${method.toUpperCase()} ${routePath} in its front matter \`routes:\``)
    }
  }

  if (fs.existsSync(path.join(root, MCP_DOCS_PATH))) {
    const headMcp = mcpToolsFromText(fs.readFileSync(path.join(root, MCP_DOCS_PATH), "utf8"))
    const mapBase = mapRangeStr.split("..")[0]
    const baseMcpText = gitShow(root, mapBase, MCP_DOCS_PATH)
    const baseMcp = baseMcpText ? mcpToolsFromText(baseMcpText) : []
    const newMcp = headMcp.filter((t) => !baseMcp.includes(t))
    const mcpMap = mcpToolOwners(root)
    for (const tool of newMcp) {
      if (!mcpMap.has(tool)) {
        fails.push(
          `no document declares MCP tool ${JSON.stringify(tool)} in its front matter \`mcp_tools:\``,
        )
      }
    }
  }

  if (diffTouches(root, mapRangeStr, RENDER_PATHS)) {
    const owner = path.join("docs/agents/45-render-contract.md")
    if (!fs.existsSync(path.join(root, owner))) {
      fails.push(`${owner}: render contract files changed in range but document missing`)
    }
  }

  for (const pagePath of fePageAddsDeletes(root, mapRangeStr)) {
    const uiDoc = "docs/agents/46-ui-reference.md"
    if (!fs.existsSync(path.join(root, uiDoc))) {
      fails.push(`${uiDoc}: new or removed FE page ${pagePath} but ui-reference missing`)
    }
  }

  if (fs.existsSync(path.join(root, CONFIG_SPECS_PATH))) {
    const headCfg = configKeysFromText(fs.readFileSync(path.join(root, CONFIG_SPECS_PATH), "utf8"))
    const mapBase = mapRangeStr.split("..")[0]
    const baseCfgText = gitShow(root, mapBase, CONFIG_SPECS_PATH)
    const baseCfg = baseCfgText ? configKeysFromText(baseCfgText) : []
    const newCfg = headCfg.filter((k) => !baseCfg.includes(k))
    if (newCfg.length > 0) {
      const diag = "docs/agents/92-diagnostics.md"
      if (!fs.existsSync(path.join(root, diag))) {
        fails.push(`${diag}: new config keys in range but diagnostics doc missing`)
      }
    }
  }

  const marked = markedBugIds(root)
  const published = idsInKnownIssues(root)
  if (!PUBLISH_REAL_ISSUES) {
    for (const id of published) {
      if (id !== "#EXAMPLE") {
        fails.push(`${KNOWN_ISSUES_PATH}: real issue id ${id} must not appear while publication is disabled`)
      }
    }
    for (const id of marked) {
      if (published.has(id)) {
        fails.push(`${KNOWN_ISSUES_PATH}: marked issue ${id} must not appear while publication is disabled`)
      }
    }
  } else {
    for (const id of marked) {
      if (!published.has(id)) {
        fails.push(`${KNOWN_ISSUES_PATH}: marked issue ${id} missing from known-issues page`)
      }
    }
  }

  return { fails, skipped: false, range: rangeStr }
}

export function main() {
  try {
    const { root, range } = parseArgs(process.argv)
    const docsForLlm = path.join(root, "docs-for-llm")
    if (!fs.existsSync(docsForLlm)) {
      process.exit(0)
    }
    if (!fs.existsSync(path.join(docsForLlm, "bugs"))) {
      process.exit(0)
    }
    try {
      execFileSync("git", ["-C", root, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      process.exit(0)
    }

    const { fails, skipped } = runFreshnessChecks(root, range)
    if (skipped) {
      process.exit(0)
    }
    if (fails.length === 0) {
      console.log("✅ docs-freshness: 9 checks, nothing stale")
      process.exit(0)
    }
    console.error("🔴 docs-freshness:")
    for (const f of fails) console.error(`  ${f}`)
    process.exit(1)
  } catch {
    process.exit(0)
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) main()
