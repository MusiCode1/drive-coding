#!/usr/bin/env node
// docs-list.mjs — one line per document, so an agent can pick what to read
// without opening 18 files. Reports gaps instead of skipping them silently.
//
// Usage: bun run docs:list

import { listDocFiles, readDoc } from "./agent-docs-lib.mjs"

const root = process.cwd()
const files = listDocFiles(root)
if (files.length === 0) {
  console.error("no documents under docs/agents/")
  process.exit(1)
}

for (const name of files) {
  const doc = readDoc(root, name)
  if (!doc.front.ok) {
    console.log(`${doc.rel} - [missing front matter]`)
    continue
  }
  const fm = doc.front.data
  const summaryOk = typeof fm.summary === "string" && fm.summary.trim() !== ""
  console.log(`${doc.rel} - ${summaryOk ? fm.summary : "[missing front matter]"}`)
  const rw = Array.isArray(fm.read_when) ? fm.read_when : fm.read_when ? [fm.read_when] : []
  const rwOk =
    Array.isArray(rw) &&
    rw.length > 0 &&
    rw.every((t) => typeof t === "string" && t.trim().length > 0)
  if (!rwOk) console.log("  Read when: [missing front matter]")
  else console.log(`  Read when: ${rw.join("; ")}`)
}
