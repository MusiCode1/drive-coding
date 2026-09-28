#!/usr/bin/env node
// gen-known-issues.mjs — builds docs/agents/99-known-issues.md from docs-for-llm/bugs/.
// Zero npm dependencies. Fail-open on missing private docs tree (public clone).

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseFrontMatter } from "./agent-docs-lib.mjs"

/** Publication of real issue data is OFF (user decision 2026-09-29, plan §0 item 8).
 *  Flipping this to true is a deliberate act: it publishes every bug document that
 *  carries `public_summary_en`. Do not flip it as a side effect of another change. */
export const PUBLISH_REAL_ISSUES = false

const EXCLUDED_NAMES = new Set(["README.md", "_TEMPLATE.md"])
const VALID_AREAS = new Set(["fe", "be", "core", "provider", "infra"])
const VALID_SEVERITIES = new Set(["blocker", "major", "minor"])
const UPDATED_LITERAL = "2026-09-29"
const OUTPUT = path.join("docs", "agents", "99-known-issues.md")

const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

const SYNTHETIC_ROW = {
  id: "#EXAMPLE",
  area: "example",
  severity: "minor",
  status: "open",
  summary:
    "This row is a synthetic example, not a real issue. It shows the shape a published entry takes.",
  affects_version: "",
}

/**
 * @param {string} root repo root
 * @param {{ publish?: boolean }} [opts]
 * @returns {{ markdown: string, reports: string[], entries: object[] }}
 */
export function buildKnownIssuesDocument(root, opts = {}) {
  const publish = opts.publish ?? PUBLISH_REAL_ISSUES
  const reports = []
  const entries = []
  let markedSkipped = 0
  let noFrontMatter = 0
  let invalidMeta = 0

  const openDir = path.join(root, "docs-for-llm", "bugs")
  const archiveDir = path.join(openDir, "archive")

  /** @param {string} dir @param {"open"|"closed"} status */
  function scanDir(dir, status) {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".md") || EXCLUDED_NAMES.has(name)) continue
      const filePath = path.join(dir, name)
      const rel = path.relative(path.join(root, "docs-for-llm"), filePath)
      const text = fs.readFileSync(filePath, "utf8")
      if (!text.startsWith("---\n")) {
        noFrontMatter++
        continue
      }
      const parsed = parseFrontMatter(text)
      if (!parsed.ok) {
        noFrontMatter++
        continue
      }
      const fm = parsed.data
      const id = fm.id
      const area = fm.area
      const severity = fm.severity
      if (!VALID_AREAS.has(String(area ?? "")) || !VALID_SEVERITIES.has(String(severity ?? ""))) {
        invalidMeta++
        reports.push(`skipped invalid area/severity: ${rel}`)
        continue
      }
      const summary = fm.public_summary_en
      if (summary !== undefined && String(summary).trim() !== "") {
        if (!publish) {
          markedSkipped++
          continue
        }
        const bad = String(summary).match(NON_LATIN)
        if (bad) {
          const err = new Error(
            `non-Latin public_summary_en in ${rel} (id ${JSON.stringify(id)}) — docs/agents is English only`,
          )
          err.code = "NON_LATIN_SUMMARY"
          err.meta = { rel, id }
          throw err
        }
        entries.push({
          id: String(id),
          area: String(area),
          severity: String(severity),
          status,
          summary: String(summary).trim(),
          affects_version: fm.affects_version ? String(fm.affects_version) : "",
        })
      }
    }
  }

  scanDir(openDir, "open")
  scanDir(archiveDir, "closed")

  const summaryReports = []
  if (markedSkipped > 0) {
    summaryReports.push(`skipped ${markedSkipped} marked issue(s) — publication disabled`)
  }
  if (noFrontMatter > 0) {
    summaryReports.push(`skipped ${noFrontMatter} document(s) without front matter`)
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  entries.push(SYNTHETIC_ROW)

  const corePath = path.join(root, "packages/core/src/docs/index.ts")
  const docsVersion = fs.readFileSync(corePath, "utf8").match(/DOCS_VERSION\s*=\s*"([^"]+)"/)?.[1]
  if (!docsVersion) throw new Error("DOCS_VERSION not found")

  const front = `---
id: known-issues
title: Known issues
summary: Issues that are known and tracked, published from the project issue register.
read_when:
  - The backend behaved strangely and you want to know whether it is a known issue
  - You are about to file a bug report and want to check it is not already tracked
tags: [known-issues]
surface: [http, mcp, cli]
stability: transitional
docs_version: ${docsVersion}
updated: ${UPDATED_LITERAL}
---

No tracked issue is currently marked for publication. This page lists only issues explicitly marked \`public_summary_en\`.

There is no CI in this repository. The gates described here run in git hooks and can be skipped with \`--no-verify\`.

| Issue | Area | Severity | Status | Summary | Affects version |
| --- | --- | --- | --- | --- | --- |
`

  const rows = entries
    .map(
      (e) =>
        `| \`${e.id}\` | ${e.area} | ${e.severity} | ${e.status} | ${e.summary} | ${e.affects_version} |`,
    )
    .join("\n")

  return {
    markdown: `${front}${rows}\n`,
    reports: [...summaryReports, ...reports],
    entries,
  }
}

export function main() {
  try {
    const root = process.argv[2] ?? process.cwd()
    const docsForLlm = path.join(root, "docs-for-llm")
    if (!fs.existsSync(docsForLlm)) {
      process.exit(0)
    }
    const bugsDir = path.join(docsForLlm, "bugs")
    if (!fs.existsSync(bugsDir)) {
      process.exit(0)
    }
    try {
      fs.readdirSync(bugsDir)
    } catch {
      process.exit(0)
    }

    const { markdown, reports } = buildKnownIssuesDocument(root)
    const outPath = path.join(root, OUTPUT)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, markdown, "utf8")
    for (const line of reports) {
      console.error(line)
    }
    process.exit(0)
  } catch (e) {
    if (e?.code === "NON_LATIN_SUMMARY") {
      console.error(`🔴 ${e.message}`)
      process.exit(1)
    }
    process.exit(0)
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) main()
