// Shared front-matter reader for the docs/agents/ tooling.
// Zero dependencies — same constraint as lint-no-hebrew-in-code.mjs and
// lint-file-size.mjs, so the git hooks run in any environment.

import fs from "node:fs"
import path from "node:path"

export const DOCS_DIR = path.join("docs", "agents")

/** Minimal YAML subset: `key: scalar`, `key: [a, b]`, and `key:` + `- item` lists. */
export function parseFrontMatter(text) {
  if (!text.startsWith("---\n")) return { ok: false, reason: "missing front matter" }
  const end = text.indexOf("\n---", 3)
  if (end === -1) return { ok: false, reason: "unterminated front matter" }
  const body = text.slice(3, end)
  const data = {}
  let key = null
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+$/, "")
    if (!line || line.trimStart().startsWith("#")) continue
    const item = line.match(/^ {2,}-\s+(.*)$/)
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = []
      data[key].push(unquote(item[1]))
      continue
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (!kv) return { ok: false, reason: `unparsable front-matter line: ${line}` }
    key = kv[1]
    const value = kv[2]
    if (value === "") data[key] = []
    else if (value.startsWith("[") && value.endsWith("]"))
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter((s) => s !== "")
    else data[key] = unquote(value)
  }
  return { ok: true, data, bodyText: text.slice(end + 4) }
}

function unquote(s) {
  const m = s.match(/^"(.*)"$/) || s.match(/^'(.*)'$/)
  return m ? m[1] : s
}

export function listDocFiles(root) {
  const dir = path.join(root, DOCS_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== "index.md")
    .sort()
}

export function readDoc(root, name) {
  const rel = path.posix.join("docs/agents", name)
  const text = fs.readFileSync(path.join(root, DOCS_DIR, name), "utf8")
  return { name, rel, text, front: parseFrontMatter(text) }
}

/** Headings of the body, for index.json. */
export function headings(bodyText) {
  return bodyText
    .split("\n")
    .filter((l) => /^#{1,6} /.test(l))
    .map((l) => l.replace(/^#+\s+/, "").trim())
}

/** llms.txt body — shared by docs:index and lint:docs check 10. */
export function renderLlmsTxt(entries) {
  const lines = [
    "# drive-coding agent docs",
    "",
    "Agent-facing documentation for drive-coding HTTP, MCP, and session lifecycle.",
    "",
    ...entries.map((d) => {
      const file = path.basename(d.path)
      return `- [${d.title}](docs/agents/${file}): ${d.summary}`
    }),
    "",
  ]
  return lines.join("\n")
}
