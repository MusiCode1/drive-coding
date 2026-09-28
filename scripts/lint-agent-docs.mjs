#!/usr/bin/env node
// lint-agent-docs.mjs — gate over docs/agents/.
//
// Nine checks, each able to fail on its own:
//   1. every *.md has parsable front matter with the required keys
//   2. read_when is a list of at least two natural-language triggers
//   3. every tag is declared in docs/agents/tags.json
//   4. index.json matches what is on disk (regenerate + compare)
//   5. English only — no non-Latin script anywhere in the file
//   6. DOCS_VERSION is the single source of truth — index.json and every
//      doc's docs_version must equal it. Without this the claim is a promise.
//   7. routes: shape + must exist in the live HTTP surface
//   8. mcp_tools: subset of McpToolName union
//   9. front-matter `id` is unique across docs/agents/*.md
//  10. llms.txt matches regenerate (same as check 4 for index.json)
//
// Exit 0 = clean, 1 = violations. Zero dependencies (pure node).

import fs from "node:fs"
import path from "node:path"
import { headings, listDocFiles, readDoc, renderLlmsTxt } from "./agent-docs-lib.mjs"
import { extractOperations } from "./lint-api-documented.mjs"

/** Same out-of-scope pairs as lint-api-documented.mjs — documentable HTTP surface. */
const OUT_OF_SCOPE = [
  ["get", "/*"],
  ["all", "/proxy/:provider/*"],
]

const ROUTE_ITEM = /^(GET|POST|PUT|PATCH|DELETE) (\S+)$/

/** Union members of `export type McpToolName` — not MCP_TOOL_META (11). */
export function mcpToolVocabulary(root) {
  const p = path.join(root, "packages/core/src/schemas/mcp-docs.ts")
  const text = fs.readFileSync(p, "utf8")
  const start = text.indexOf("export type McpToolName")
  if (start === -1) throw new Error("export type McpToolName not found in mcp-docs.ts")
  const tail = text.slice(start)
  const end = tail.search(/\nexport (const|type|function)/)
  const block = end === -1 ? tail : tail.slice(0, end)
  const names = [...block.matchAll(/\|\s*"([^"]+)"/g)].map((m) => m[1])
  if (names.length === 0) throw new Error("no McpToolName union members parsed")
  return names
}

export function documentableRouteKeys(root) {
  const { operations } = extractOperations(root)
  return new Set(
    operations
      .filter((o) => !OUT_OF_SCOPE.some(([m, p]) => m === o.method && p === o.path))
      .map((o) => `${o.method} ${o.path}`),
  )
}

const REQUIRED = [
  "id",
  "title",
  "summary",
  "read_when",
  "tags",
  "surface",
  "stability",
  "docs_version",
  "updated",
]
const OPTIONAL = ["routes", "mcp_tools"]
const STABILITY = ["stable", "transitional", "experimental"]
// Any script outside Basic Latin + punctuation. Hebrew lives in U+0590–U+05FF.
const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

const root = process.argv[2] ?? process.cwd()
const fails = []
const fail = (file, msg) => fails.push(`${file}: ${msg}`)

const tagsPath = path.join(root, "docs/agents/tags.json")
if (!fs.existsSync(tagsPath)) {
  console.error("🔴 agent-docs: docs/agents/tags.json is missing")
  process.exit(1)
}
const vocabulary = new Set(JSON.parse(fs.readFileSync(tagsPath, "utf8")).tags)

const MD_EXT = /\.(md|markdown|mdown|mkd)$/i
const agentsDir = path.join(root, "docs", "agents")

/** Every markdown-like file under docs/agents/ must be a top-level lowercase `.md` (indexed). */
function findUnindexedMarkdownFiles(dir, relPrefix = "docs/agents") {
  const found = []
  if (!fs.existsSync(dir)) return found
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(relPrefix, ent.name)
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      found.push(...findUnindexedMarkdownFiles(abs, rel))
      continue
    }
    if (!MD_EXT.test(ent.name)) continue
    const topLevel = relPrefix === "docs/agents"
    if (!(topLevel && ent.name.endsWith(".md"))) {
      const why = topLevel
        ? "only lowercase .md at the top level of docs/agents/ is indexed"
        : "markdown in a subdirectory is not indexed"
      found.push({ rel, why })
    }
  }
  return found
}

for (const { rel, why } of findUnindexedMarkdownFiles(agentsDir)) {
  fail(rel, why)
}

const files = listDocFiles(root)
if (files.length === 0) {
  console.error("🔴 agent-docs: no documents found under docs/agents/")
  process.exit(1)
}

const codeRoutes = documentableRouteKeys(root)
let mcpVocab
try {
  mcpVocab = new Set(mcpToolVocabulary(root))
} catch (e) {
  fail("packages/core/src/schemas/mcp-docs.ts", e.message)
  mcpVocab = new Set()
}

const entries = []
for (const name of files) {
  const doc = readDoc(root, name)

  // 5 — English only.
  const bad = doc.text.match(NON_LATIN)
  if (bad) {
    const line = doc.text.slice(0, doc.text.indexOf(bad[0])).split("\n").length
    fail(
      doc.rel,
      `non-Latin character ${JSON.stringify(bad[0])} on line ${line} — docs/agents is English only`,
    )
  }

  // 1 — front matter.
  if (!doc.front.ok) {
    fail(doc.rel, doc.front.reason)
    continue
  }
  const fm = doc.front.data
  for (const key of REQUIRED) {
    const v = fm[key]
    if (
      v === undefined ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0)
    )
      fail(doc.rel, `missing or empty required front-matter key \`${key}\``)
  }
  for (const key of Object.keys(fm))
    if (!REQUIRED.includes(key) && !OPTIONAL.includes(key))
      fail(doc.rel, `unknown front-matter key \`${key}\``)

  // 2 — read_when is a list of triggers, not one sentence.
  const rw = fm.read_when
  if (rw !== undefined) {
    if (!Array.isArray(rw))
      fail(doc.rel, "`read_when` must be a YAML list of triggers, not a single string")
    else if (rw.length < 2)
      fail(doc.rel, `\`read_when\` has ${rw.length} trigger(s); at least 2 are required`)
    else if (rw.some((t) => typeof t !== "string" || t.trim().length < 10))
      fail(doc.rel, "each `read_when` trigger must be a natural-language sentence (>= 10 chars)")
  }

  // 3 — closed tag vocabulary.
  for (const tag of Array.isArray(fm.tags) ? fm.tags : [])
    if (!vocabulary.has(tag))
      fail(doc.rel, `tag \`${tag}\` is not declared in docs/agents/tags.json`)

  if (fm.stability !== undefined && !STABILITY.includes(fm.stability))
    fail(doc.rel, `stability \`${fm.stability}\` is not one of ${STABILITY.join(" | ")}`)

  // 7 — routes: shape + must exist in the live HTTP surface.
  for (const item of Array.isArray(fm.routes) ? fm.routes : []) {
    if (typeof item !== "string") {
      fail(doc.rel, "`routes` items must be strings")
      continue
    }
    const m = item.match(ROUTE_ITEM)
    if (!m) fail(doc.rel, `routes item ${JSON.stringify(item)} must match METHOD /path`)
    else if (!codeRoutes.has(`${m[1].toLowerCase()} ${m[2]}`))
      fail(doc.rel, `routes item ${JSON.stringify(item)} is not a documentable HTTP operation`)
  }

  // 8 — mcp_tools: subset of McpToolName union (derived, not MCP_TOOL_META).
  for (const tool of Array.isArray(fm.mcp_tools) ? fm.mcp_tools : []) {
    if (typeof tool !== "string") {
      fail(doc.rel, "`mcp_tools` items must be strings")
      continue
    }
    if (!mcpVocab.has(tool))
      fail(doc.rel, `mcp_tools item ${JSON.stringify(tool)} is not a known MCP tool name`)
  }

  // 9 — duplicate id (checked after loop via map).
  entries.push({
    id: fm.id,
    title: fm.title,
    summary: fm.summary,
    read_when: Array.isArray(fm.read_when) ? fm.read_when : [],
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    surface: Array.isArray(fm.surface) ? fm.surface : [],
    stability: fm.stability,
    docs_version: fm.docs_version,
    routes: Array.isArray(fm.routes) ? fm.routes : [],
    mcp_tools: Array.isArray(fm.mcp_tools) ? fm.mcp_tools : [],
    path: doc.rel,
    headings: headings(doc.front.bodyText),
  })
}

// 9 — unique front-matter id.
const idToPaths = new Map()
for (const e of entries) {
  const prev = idToPaths.get(e.id)
  if (prev) fail(e.path, `duplicate front-matter id \`${e.id}\` (also in ${prev})`)
  else idToPaths.set(e.id, e.path)
}

// DOCS_VERSION owns the version. Read it here so check 6 can hold the copies together.
const corePath = path.join(root, "packages/core/src/docs/index.ts")
const docsVersion = fs.existsSync(corePath)
  ? fs.readFileSync(corePath, "utf8").match(/DOCS_VERSION\s*=\s*"([^"]+)"/)?.[1]
  : undefined
if (!docsVersion)
  fail(path.relative(root, corePath), "DOCS_VERSION not found — it is the single source of truth")

// 4 — index.json matches disk.
const indexPath = path.join(root, "docs/agents/index.json")
if (!fs.existsSync(indexPath)) {
  fail("docs/agents/index.json", "missing — run `bun run docs:index`")
} else {
  const onDisk = JSON.parse(fs.readFileSync(indexPath, "utf8"))
  const actual = JSON.stringify(entries)

  // 6 — the version exists in three places; none of them may drift.
  if (docsVersion && onDisk.docsVersion !== docsVersion)
    fail(
      "docs/agents/index.json",
      `docsVersion ${JSON.stringify(onDisk.docsVersion)} != DOCS_VERSION ${JSON.stringify(docsVersion)}`,
    )
  for (const e of entries)
    if (docsVersion && e.docs_version !== docsVersion)
      fail(
        e.path,
        `docs_version ${JSON.stringify(e.docs_version)} != DOCS_VERSION ${JSON.stringify(docsVersion)}`,
      )

  if (JSON.stringify(onDisk.docs ?? []) !== actual) {
    const idsIndexed = new Set((onDisk.docs ?? []).map((d) => d.path))
    const idsActual = new Set(entries.map((d) => d.path))
    const missing = [...idsActual].filter((p) => !idsIndexed.has(p))
    const extra = [...idsIndexed].filter((p) => !idsActual.has(p))
    const detail = [
      missing.length ? `not indexed: ${missing.join(", ")}` : "",
      extra.length ? `indexed but absent: ${extra.join(", ")}` : "",
      !missing.length && !extra.length ? "front-matter drifted from the index" : "",
    ]
      .filter(Boolean)
      .join("; ")
    fail("docs/agents/index.json", `stale — ${detail}. Run \`bun run docs:index\``)
  }
}

// 10 — llms.txt matches disk (regenerate + compare).
const llmsPath = path.join(root, "llms.txt")
const llmsExpected = renderLlmsTxt(entries)
if (!fs.existsSync(llmsPath)) {
  fail("llms.txt", "missing — run `bun run docs:index`")
} else if (fs.readFileSync(llmsPath, "utf8") !== llmsExpected) {
  fail("llms.txt", "stale — run `bun run docs:index`")
}

if (fails.length > 0) {
  console.error("🔴 agent-docs:")
  for (const f of fails) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`✅ agent-docs: ${files.length} documents, front matter and index clean`)
