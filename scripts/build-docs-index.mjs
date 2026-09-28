#!/usr/bin/env node
// build-docs-index.mjs — regenerates docs/agents/index.json from the *.md front matter.
// `--check` prints nothing and exits 1 if the file on disk is stale.

import fs from "node:fs"
import path from "node:path"
import { headings, listDocFiles, readDoc } from "./agent-docs-lib.mjs"

const root = process.cwd()
const check = process.argv.includes("--check")

const docs = []
for (const name of listDocFiles(root)) {
  const doc = readDoc(root, name)
  if (!doc.front.ok) {
    console.error(`🔴 ${doc.rel}: ${doc.front.reason} — cannot index`)
    process.exit(1)
  }
  const fm = doc.front.data
  docs.push({
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

// docsVersion is owned by packages/core/src/docs — read it, never invent it.
const coreDocs = fs.readFileSync(path.join(root, "packages/core/src/docs/index.ts"), "utf8")
const docsVersion = coreDocs.match(/DOCS_VERSION\s*=\s*"([^"]+)"/)?.[1]
if (!docsVersion) {
  console.error("🔴 DOCS_VERSION not found in packages/core/src/docs/index.ts")
  process.exit(1)
}

const out = `${JSON.stringify({ docsVersion, docs }, null, 2)}\n`
const target = path.join(root, "docs/agents/index.json")
const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""

if (check) process.exit(out === current ? 0 : 1)
fs.writeFileSync(target, out)
console.log(`✅ docs/agents/index.json — ${docs.length} documents`)
