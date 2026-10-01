#!/usr/bin/env node
// lint-api-documented.mjs — gate: every documentable HTTP operation must appear in openapi.json.
//
// exit 0 = clean · exit 1 = violations. Pure node, zero dependencies.
//
// Two passes (see plans/probes/api-route-extract.probe.mjs): pass A attributes via Hono-typed
// receivers; pass B is receiver-agnostic and fails on any path literal pass A missed.

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const METHODS = "get|post|put|patch|delete|all|on"

/** Transparent by design — not part of the documentable surface. */
const OUT_OF_SCOPE = [
  ["get", "/*"], // static FE catch-all (boot/app.ts — twice: binary manifest + FE_STATIC_DIR)
  ["all", "/proxy/:provider/*"], // pass-through proxy (delivery/http-proxy.ts)
]

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e.name)) out.push(p)
  }
  return out
}

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length

function honoNames(text) {
  const names = new Set()
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*Hono\b/g)) names.add(m[1])
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono\b/g))
    names.add(m[1])
  return names
}

export function extractOperations(root) {
  const operations = []
  const unattributed = []
  let registrations = 0
  let middlewareIgnored = 0

  for (const file of walk(path.join(root, "packages/backend/src"))) {
    const text = fs.readFileSync(file, "utf8")
    const rel = path.relative(root, file)
    const hono = honoNames(text)
    const attributed = new Set()

    for (const m of text.matchAll(
      new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${METHODS}|use)\\s*\\(\\s*`, "g"),
    )) {
      if (!hono.has(m[1])) continue
      const head = m.index + m[0].length
      const rest = text.slice(head, head + 200)
      const arr = rest.match(/^\[([^\]]*)\]\s*,\s*(["'`])(\/[^"'`\n]*)\2/)
      const str = rest.match(/^(["'`])(\/[^"'`\n]*)\1/)
      if (m[2] === "use") {
        if (str || arr) middlewareIgnored++
        if (str) attributed.add(head)
        continue
      }
      const line = lineOf(text, m.index)
      if (arr) {
        registrations++
        attributed.add(head + arr[0].lastIndexOf(arr[3]) - 1)
        for (const mm of [...arr[1].matchAll(/["'`]([A-Za-z]+)["'`]/g)].map((x) =>
          x[1].toLowerCase(),
        ))
          operations.push({ method: mm, path: arr[3], file: rel, line, form: "array-first-arg" })
      } else if (str) {
        registrations++
        attributed.add(head)
        operations.push({ method: m[2], path: str[2], file: rel, line, form: "plain" })
      }
    }

    for (const m of text.matchAll(
      new RegExp(
        `\\.\\s*(${METHODS})\\s*\\(\\s*(?:\\[[^\\]]*\\]\\s*,\\s*)?(["'\`])(\\/[^"'\`\\n]*)\\2`,
        "g",
      ),
    )) {
      const off = m.index + m[0].length - m[3].length - 2
      if (!attributed.has(off))
        unattributed.push({ file: rel, line: lineOf(text, m.index), method: m[1], path: m[3] })
    }
  }
  return { operations, unattributed, registrations, middlewareIgnored }
}

/** (method, path) pairs documented by docs/agents/openapi.json. */
export function documentedOperations(root) {
  const p = path.join(root, "docs/agents/openapi.json")
  if (!fs.existsSync(p)) return { ok: false, reason: "docs/agents/openapi.json does not exist" }
  let spec
  try {
    spec = JSON.parse(fs.readFileSync(p, "utf8"))
  } catch (e) {
    return { ok: false, reason: `docs/agents/openapi.json is not valid JSON — ${e.message}` }
  }
  const set = new Set()
  for (const [route, item] of Object.entries(spec.paths ?? {}))
    for (const method of Object.keys(item))
      if (method !== "parameters" && !method.startsWith("x-"))
        set.add(`${method.toLowerCase()} ${route}`)
  return { ok: true, set }
}

function runGate(root) {
  const { operations, unattributed, registrations, middlewareIgnored } = extractOperations(root)
  const inScope = operations.filter(
    (o) => !OUT_OF_SCOPE.some(([m, p]) => m === o.method && p === o.path),
  )

  console.log(`route registrations      : ${registrations}`)
  console.log(`  plain                  : ${operations.filter((o) => o.form === "plain").length}`)
  console.log(
    `  array-first-arg ops    : ${operations.filter((o) => o.form === "array-first-arg").length}  (one registration carrying N methods)`,
  )
  console.log(`use() middleware ignored : ${middlewareIgnored}`)
  console.log(`operations (method+path) : ${operations.length}`)
  console.log(`  out of scope           : ${operations.length - inScope.length}`)
  console.log(`  DOCUMENTABLE           : ${inScope.length}`)
  console.log(`unattributed             : ${unattributed.length}`)
  for (const u of unattributed)
    console.log(
      `    🔴 ${u.file}:${u.line} .${u.method}("${u.path}") — unrecognized registration form`,
    )

  const doc = documentedOperations(root)
  console.log("\n=== GATE VERDICT ===")
  if (!doc.ok) console.log(`🔴 ${doc.reason}`)
  const codeKeys = inScope.map((o) => `${o.method} ${o.path}`)
  const documented = doc.ok ? doc.set : new Set()
  const missing = codeKeys.filter((k) => !documented.has(k))
  const extra = [...documented].filter((k) => !codeKeys.includes(k))
  console.log(`in code, not in spec : ${missing.length}`)
  console.log(`in spec, not in code : ${extra.length}`)
  for (const k of missing.slice(0, 5)) console.log(`    missing: ${k}`)
  if (missing.length > 5) console.log(`    … and ${missing.length - 5} more`)
  for (const k of extra) console.log(`    stale  : ${k}`)

  const failed = !doc.ok || missing.length || extra.length || unattributed.length
  return failed ? 1 : 0
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  const root = process.argv[2] ?? process.cwd()
  process.exit(runGate(root))
}
