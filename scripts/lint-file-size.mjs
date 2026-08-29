#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noAssignInExpressions: verbatim copy from census.mjs — do not reimplement
// biome-ignore-all lint/suspicious/noDuplicateElseIf: verbatim copy from census.mjs — do not reimplement
// biome-ignore-all lint/style/useTemplate: census copy uses string concat; keep measurement byte-faithful
/**
 * lint-file-size.mjs — monotonic size+impurity ratchet.
 *
 * Fail only when:
 *   (1) a baseline file grew (metric or impurity)
 *   (2) a new file is over its effective budget
 *   (3) a non-baseline file crossed its effective budget
 * A shrink without --update-baseline/--write-down also fails (stale high baseline = slack to grow back).
 * --update-baseline / --write-down refuses to raise any number.
 *
 * Usage (from repo root):
 *   node scripts/lint-file-size.mjs
 *   node scripts/lint-file-size.mjs --update-baseline
 *   node scripts/lint-file-size.mjs --write-down
 *   node scripts/lint-file-size.mjs --init-baseline
 *
 * Skip via `git commit --no-verify`. There is no CI; this is a local + dod-check hook, not an unbypassable gate.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// ─── COPY FROM artifacts/census.mjs (do not reimplement) ────────────────────
const LAYERS = [
  "routes",
  "components",
  "view-models",
  "engines",
  "adapters",
  "actions",
  "session",
  "util",
  "other",
]

const IMPURITY_KINDS = [
  "await",
  "effect",
  "timer",
  "clock",
  "fetch",
  "nodeImport",
  "envBody",
  "domGlobal",
]

const NODE_BUILTINS = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]

function walkSrc(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue
      walkSrc(p, acc)
    } else if (ent.isFile()) {
      if (ent.name.endsWith(".d.ts")) continue
      if (ent.name.endsWith(".ts") || ent.name.endsWith(".svelte")) acc.push(p)
    }
  }
  return acc
}

function isTestFile(relPosix) {
  const base = path.posix.basename(relPosix)
  return base.includes(".test.") || relPosix.split("/").includes("__tests__")
}

function classifyLayer(relPosix) {
  const parts = relPosix.split("/")
  const srcIdx = parts.indexOf("src")
  const after = srcIdx >= 0 ? parts.slice(srcIdx + 1) : parts
  let found = "other"
  for (const part of after) {
    if (part === "other") continue
    if (LAYERS.includes(part)) found = part
  }
  return found
}

function extractScriptBlocks(src) {
  const blocks = []
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(src))) blocks.push(m[1])
  return blocks
}

/** Same convention as `wc -l`: number of newline characters. */
function countLines(src) {
  let n = 0
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") n++
  return n
}

/**
 * Visual lines inside a `<script>` capture: drop the single newline that
 * usually sits against the opening/closing tags, then count remaining lines.
 */
function countScriptBlockLines(block) {
  let s = block
  if (s.startsWith("\n")) s = s.slice(1)
  if (s.endsWith("\n")) s = s.slice(0, -1)
  if (s.length === 0) return 0
  return s.split("\n").length
}

function countScriptLines(src) {
  const blocks = extractScriptBlocks(src)
  let n = 0
  for (const b of blocks) n += countScriptBlockLines(b)
  return n
}

function analysisSource(absPath, raw) {
  if (absPath.endsWith(".svelte") && !absPath.endsWith(".svelte.ts")) {
    return extractScriptBlocks(raw).join("\n")
  }
  return raw
}

// ─── comment / string strip (keeps newlines + indexes) ──────────────────────

function stripComments(src, blankStrings) {
  const out = []
  const n = src.length
  let i = 0
  const keep = (ch) => (blankStrings && ch !== "\n" ? " " : ch)
  while (i < n) {
    const c = src[i]
    const next = i + 1 < n ? src[i + 1] : ""
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        out.push(" ")
        i++
      }
      continue
    }
    if (c === "/" && next === "*") {
      out.push(" ", " ")
      i += 2
      while (i < n && !(src[i] === "*" && i + 1 < n && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ")
        i++
      }
      if (i < n) {
        out.push(" ", " ")
        i += 2
      }
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      out.push(keep(c))
      i++
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") {
          out.push(keep(src[i]))
          i++
          if (i < n) {
            out.push(src[i] === "\n" ? "\n" : keep(src[i]))
            i++
          }
          continue
        }
        out.push(src[i] === "\n" ? "\n" : keep(src[i]))
        i++
      }
      if (i < n) {
        out.push(keep(src[i]))
        i++
      }
      continue
    }
    if (c === "`") {
      out.push(keep(c))
      i++
      while (i < n) {
        if (src[i] === "\\") {
          out.push(keep(src[i]))
          i++
          if (i < n) {
            out.push(src[i] === "\n" ? "\n" : keep(src[i]))
            i++
          }
          continue
        }
        if (src[i] === "`") {
          out.push(keep(src[i]))
          i++
          break
        }
        if (src[i] === "$" && i + 1 < n && src[i + 1] === "{") {
          out.push(keep("$"), keep("{"))
          i += 2
          const innerStart = i
          let depth = 1
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++
            else if (src[i] === "}") depth--
            if (depth > 0) i++
          }
          out.push(stripComments(src.slice(innerStart, i), blankStrings))
          if (i < n && src[i] === "}") {
            out.push(keep("}"))
            i++
          }
          continue
        }
        out.push(src[i] === "\n" ? "\n" : keep(src[i]))
        i++
      }
      continue
    }
    out.push(c)
    i++
  }
  return out.join("")
}

function stripCommentsAndStrings(src) {
  return stripComments(src, true)
}

function stripCommentsKeepStrings(src) {
  return stripComments(src, false)
}

// ─── injection vs coupling ──────────────────────────────────────────────────

function matchingCloseParen(code, openIdx) {
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    const ch = code[i]
    if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function skipTypeAfterParen(code, closeIdx) {
  let i = closeIdx + 1
  while (i < code.length && /\s/.test(code[i])) i++
  if (code[i] !== ":") return i
  i++
  let depth = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === "(" || ch === "{" || ch === "[") depth++
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && ch === "=" && code[i + 1] === ">") break
    else if (depth === 0 && ch === "{") break
    else if (depth === 0 && ch === ";") break
    i++
    if (depth === 0 && (code.startsWith("=>", i) || code[i] === "{")) break
  }
  return i
}

function looksLikeParamList(code, openParenIdx) {
  const close = matchingCloseParen(code, openParenIdx)
  if (close < 0) return false
  let i = skipTypeAfterParen(code, close)
  while (i < code.length && /\s/.test(code[i])) i++
  if (code.startsWith("=>", i) || code[i] === "{") return true
  // interface / type call signatures have `;` or `:` / `,` after — not a body.
  // Still treat as a signature (default = injection).
  return true
}

function isInsideParamDefault(code, matchIndex) {
  let i = matchIndex - 1
  while (i >= 0 && /\s/.test(code[i])) i--
  if (i < 0 || code[i] !== "=") return false
  let paren = 0
  let brace = 0
  let bracket = 0
  for (let j = i; j >= 0; j--) {
    const ch = code[j]
    if (ch === ")") paren++
    else if (ch === "(") {
      if (paren === 0) return looksLikeParamList(code, j)
      paren--
    } else if (ch === "}") brace++
    else if (ch === "{") {
      if (brace === 0) return false
      brace--
    } else if (ch === "]") bracket++
    else if (ch === "[") {
      if (bracket === 0) return false
      bracket--
    }
  }
  return false
}

function findAll(code, regex) {
  const out = []
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g")
  let m
  while ((m = re.exec(code))) {
    out.push({ index: m.index, text: m[0] })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

// ─── impurity ───────────────────────────────────────────────────────────────

const RE = {
  await: /\bawait\b/g,
  effect: /\$effect(?:\.(?:pre|root|tracking))?\s*\(/g,
  timer: /\b(?:setTimeout|setInterval)\s*\(/g,
  clock: /\bDate\.now\s*\(|\bperformance\.now\s*\(|\bnew\s+Date\b|\bMath\.random\s*\(/g,
  fetch: /\bfetch\s*\(/g,
  nodeFrom: /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]node:[^'"]+['"]/g,
  nodeBare: new RegExp(
    `(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"](?:node:)?(?:${NODE_BUILTINS.join("|")})(?:\\/[^'"]*)?['"]`,
    "g",
  ),
  env: /\bprocess\.env\b/g,
  dom: /(?<![\w.$])(?:window|document|localStorage|sessionStorage|navigator)\b/g,
}

function measureImpurity(code, importCode) {
  const byKind = {
    await: 0,
    effect: 0,
    timer: 0,
    clock: 0,
    fetch: 0,
    nodeImport: 0,
    envBody: 0,
    domGlobal: 0,
  }
  const hits = []

  const add = (kind, match, injectable, src) => {
    if (injectable && isInsideParamDefault(src, match.index)) return
    byKind[kind]++
    hits.push({ kind, index: match.index })
  }

  for (const m of findAll(code, RE.await)) add("await", m, false, code)
  for (const m of findAll(code, RE.effect)) add("effect", m, false, code)
  for (const m of findAll(code, RE.timer)) add("timer", m, false, code)
  for (const m of findAll(code, RE.clock)) add("clock", m, true, code)
  for (const m of findAll(code, RE.fetch)) add("fetch", m, false, code)

  const nodeHits = new Map()
  for (const m of [...findAll(importCode, RE.nodeFrom), ...findAll(importCode, RE.nodeBare)]) {
    const key = `${m.index}:${m.text}`
    if (nodeHits.has(key)) continue
    nodeHits.set(key, m)
  }
  for (const m of nodeHits.values()) add("nodeImport", m, false, importCode)

  for (const m of findAll(code, RE.env)) add("envBody", m, true, code)
  for (const m of findAll(code, RE.dom)) {
    const after = code[m.index + m.text.length]
    // Property / optional-property declaration (`localStorage?:`, `window:`) — not the global.
    if (after === "?" || after === ":") continue
    add("domGlobal", m, true, code)
  }

  return { byKind, hits, impurity: IMPURITY_KINDS.reduce((s, k) => s + byKind[k], 0) }
}

// ─── functions / impurityShape ──────────────────────────────────────────────

function skipWs(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++
  return i
}

function matchBraces(code, openIdx) {
  if (code[openIdx] !== "{") return -1
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === "{") depth++
    else if (code[i] === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function collectFunctions(code) {
  const fns = []
  const seen = new Set()
  const push = (name, start, end) => {
    const key = `${start}:${end}`
    if (seen.has(key)) return
    seen.add(key)
    fns.push({ name, start, end })
  }

  const considerParen = (name, parenOpen) => {
    const close = matchingCloseParen(code, parenOpen)
    if (close < 0) return
    let i = skipTypeAfterParen(code, close)
    i = skipWs(code, i)
    if (code.startsWith("=>", i)) {
      i = skipWs(code, i + 2)
      if (code[i] === "{") {
        const end = matchBraces(code, i)
        if (end >= 0) push(name, parenOpen, end)
      } else {
        let end = i
        while (end < code.length && code[end] !== ";" && code[end] !== "," && code[end] !== ")")
          end++
        push(name, parenOpen, end)
      }
      return
    }
    if (code[i] === "{") {
      const end = matchBraces(code, i)
      if (end >= 0) push(name, parenOpen, end)
    }
  }

  const reFn = /(?:export\s+)?(?:async\s+)?function\s*([#\w$]*)\s*(?:<[^>]*>)?\s*\(/g
  let m
  while ((m = reFn.exec(code))) considerParen(m[1] || "anonymous", m.index + m[0].length - 1)

  const reArrow = /(?:export\s+)?(?:const|let|var)\s+([#\w$]+)\s*=\s*(?:async\s*)?(?:<[^>]*>)?\(/g
  while ((m = reArrow.exec(code))) considerParen(m[1], m.index + m[0].length - 1)

  const reMethod =
    /(?:(?:public|private|protected|static|async|override|get|set|readonly|abstract)\s+)*([#\w$]+)\s*(?:<[^>]*>)?\s*\(/g
  while ((m = reMethod.exec(code))) {
    const name = m[1]
    if (
      name === "if" ||
      name === "for" ||
      name === "while" ||
      name === "switch" ||
      name === "catch"
    )
      continue
    considerParen(name, m.index + m[0].length - 1)
  }

  return fns.sort((a, b) => a.start - b.start)
}

function impurityShape(fns, hits) {
  const names = new Set()
  let moduleHits = 0
  for (const h of hits) {
    let owner = null
    for (const fn of fns) {
      if (h.index >= fn.start && h.index <= fn.end) {
        if (!owner || fn.end - fn.start < owner.end - owner.start) owner = fn
      }
    }
    if (owner) names.add(`${owner.name}@${owner.start}`)
    else moduleHits++
  }
  return names.size + (moduleHits > 0 ? 1 : 0)
}

// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    writeDown: false,
    initBaseline: false,
    root: REPO,
    budgets: "",
    baseline: "",
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--write-down" || a === "--update-baseline") out.writeDown = true
    else if (a === "--init-baseline") out.initBaseline = true
    else if (a === "--root") out.root = path.resolve(argv[++i] ?? "")
    else if (a === "--budgets") out.budgets = path.resolve(argv[++i] ?? "")
    else if (a === "--baseline") out.baseline = path.resolve(argv[++i] ?? "")
  }
  if (!out.budgets) out.budgets = path.join(out.root, "size-budgets.json")
  if (!out.baseline) out.baseline = path.join(out.root, "size-baseline.json")
  return out
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"))
}

function purityClass(impurity, shape, scatterThreshold) {
  if (impurity === 0) return "pure"
  if (shape >= scatterThreshold) return "scattered"
  return "mixed"
}

function metricOf(file, _layerCfg) {
  if (file.layer === "components" && file.scriptLines != null) return file.scriptLines
  return file.lines
}

function baseBudget(file, budgets) {
  const cfg = budgets.layers[file.layer] ?? budgets.layers.other
  if (file.layer === "components" && file.scriptLines == null) {
    return cfg.tsHelperBudget ?? 150
  }
  return cfg.budget
}

function effectiveBudget(file, budgets) {
  if (file.kind === "test") return Infinity
  const cfg = budgets.layers[file.layer] ?? budgets.layers.other
  const base = baseBudget(file, budgets)
  const roleFlat =
    file.layer === "routes" || (file.layer === "components" && file.scriptLines != null)
  if (roleFlat || cfg.purityWeight === false) return base
  if (file.class === "pure") return Infinity
  if (file.class === "scattered") return base * 0.5
  return base
}

function concernInfixOk(relPosix) {
  const base = path.posix.basename(relPosix)
  if (base.includes("-harness.")) return true
  // stem.concern.test.ts | stem.concern.test.svelte.ts
  if (
    /\.[a-z0-9-]+\.test(\.svelte)?\.ts$/.test(base) &&
    !/^[^.]+\.test(\.svelte)?\.ts$/.test(base)
  ) {
    return true
  }
  // catch-all: foo.test.ts — allowed for existing files; new files fail
  return false
}

function declaredPureMatch(rel, budgets) {
  const globs = budgets.declaredPure?.globs ?? []
  return globs.some((g) => {
    const prefix = g.replace(/\/\*\*$/, "/")
    return rel.startsWith(prefix) || rel === g
  })
}

function measureTree(root, budgets) {
  const packagesDir = path.join(root, "packages")
  if (!fs.existsSync(packagesDir)) return []
  const absSrcDirs = fs.readdirSync(packagesDir).flatMap((pkg) => {
    const src = path.join(packagesDir, pkg, "src")
    return fs.existsSync(src) ? [src] : []
  })
  const files = []
  for (const dir of absSrcDirs) walkSrc(dir, files)
  const out = []
  for (const abs of files) {
    if (!/\.(ts|svelte)$/.test(abs)) continue
    const rel = path.relative(root, abs).split(path.sep).join("/")
    const raw = fs.readFileSync(abs, "utf8")
    const kind = isTestFile(rel) ? "test" : "prod"
    const layer = classifyLayer(rel)
    const lines = countLines(raw)
    const scriptLines =
      abs.endsWith(".svelte") && !abs.endsWith(".svelte.ts") ? countScriptLines(raw) : null
    const src = analysisSource(abs, raw)
    const stripped = stripCommentsAndStrings(src)
    // census.mjs measures node-imports from analysisSource, not the raw file
    const importCode = stripCommentsKeepStrings(src)
    const { impurity, hits } = measureImpurity(stripped, importCode)
    const shape = impurityShape(collectFunctions(stripped), hits)
    const cls = purityClass(impurity, shape, budgets.scatterThreshold)
    out.push({
      path: rel,
      kind,
      layer,
      lines,
      scriptLines,
      impurity,
      impurityShape: shape,
      class: cls,
    })
  }
  return out
}

function shouldTrack(f, eff) {
  const metric = metricOf(f)
  return metric > eff || f.impurity > 0
}

function runLint(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const budgetsPath = args.budgets
  const baselinePath = args.baseline
  if (!fs.existsSync(budgetsPath)) {
    console.error(`missing ${budgetsPath}`)
    return 2
  }
  const budgets = loadJson(budgetsPath)
  const measured = measureTree(args.root, budgets)

  if (args.initBaseline) {
    if (fs.existsSync(baselinePath)) {
      console.error(
        "size-baseline.json exists — refusing --init-baseline (delete it first, don't raise)",
      )
      return 2
    }
    const entries = {}
    for (const f of measured) {
      if (f.kind !== "prod") continue
      const metric = metricOf(f)
      const eff = effectiveBudget(f, budgets)
      // Stage-2: size-debt (metric > effective) AND impurity ratchet (impurity > 0),
      // including files still under their line budget. See docs-for-llm/investigations/2026-08-29-architecture-compliance/05-prevention.md §7 / §11.4.
      if (shouldTrack(f, eff)) {
        entries[f.path] = { metric, impurity: f.impurity, class: f.class }
      }
    }
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({ generatedFrom: "lint-file-size --init-baseline", files: entries }, null, 2) +
        "\n",
    )
    console.log(`wrote ${baselinePath} (${Object.keys(entries).length} files)`)
    return 0
  }

  if (!fs.existsSync(baselinePath)) {
    console.error("missing size-baseline.json — run --init-baseline once")
    return 2
  }
  const baselineDoc = loadJson(baselinePath)
  const baseline = baselineDoc.files
  const exceptions = new Set(budgets.declaredPure?.exceptions ?? [])
  /** @type {string[]} */
  const fails = []
  /** @type {string[]} */
  const stale = []
  const next = { ...baseline }

  const byPath = new Map(measured.map((f) => [f.path, f]))

  for (const f of measured) {
    const metric = metricOf(f)
    const eff = effectiveBudget(f, budgets)
    const prev = baseline[f.path]

    if (
      f.kind === "prod" &&
      declaredPureMatch(f.path, budgets) &&
      f.impurity > 0 &&
      !exceptions.has(f.path) &&
      !prev
    ) {
      fails.push(`${f.path}: declared-pure file with impurity=${f.impurity} (must be 0)`)
    }

    if (f.kind === "test") {
      // v1: new catch-alls only. Existing catch-alls are not size-ratcheted.
      continue
    }

    if (prev) {
      const prevEff = effectiveBudget({ ...f, class: prev.class }, budgets)
      // Size-debt files (already over effective) must not grow at all.
      // Impurity-only entries may grow in lines up to the effective budget
      // (cli-resolve.ts: green on lines, red only if impurity rises — §7).
      if (metric > prev.metric) {
        if (prev.metric > prevEff || metric > eff) {
          fails.push(`${f.path}: metric grew ${prev.metric} → ${metric}`)
        }
      } else if (metric > eff && prev.metric <= prevEff) {
        fails.push(
          `${f.path}: ${metric} > effective ${eff} (${f.class}, layer=${f.layer}) — new or crossed`,
        )
      }
      if (f.impurity > prev.impurity) {
        fails.push(`${f.path}: impurity grew ${prev.impurity} → ${f.impurity}`)
      }
      if (metric < prev.metric || f.impurity < prev.impurity) {
        stale.push(
          `${f.path}: baseline stale ${prev.metric}/${prev.impurity} → ${metric}/${f.impurity}`,
        )
        next[f.path] = { metric, impurity: f.impurity, class: f.class }
      }
      // Drop only when no axis still needs tracking (under budget AND pure).
      if (metric <= eff && f.impurity === 0) {
        stale.push(`${f.path}: now under budget — drop from baseline`)
        delete next[f.path]
      }
      continue
    }

    // not in baseline
    if (metric > eff) {
      fails.push(
        `${f.path}: ${metric} > effective ${eff} (${f.class}, layer=${f.layer}) — new or crossed`,
      )
    }
  }

  for (const p of Object.keys(baseline)) {
    if (!byPath.has(p)) {
      stale.push(`${p}: missing from tree — drop from baseline`)
      delete next[p]
    }
  }

  // refuse raises in the on-disk file vs computed next
  for (const [p, ent] of Object.entries(next)) {
    const old = baseline[p]
    if (!old) continue
    if (ent.metric > old.metric || ent.impurity > old.impurity) {
      fails.push(`${p}: --write-down tried to raise (refusing)`)
    }
  }

  if (fails.length) {
    console.error("🔴 size/impurity ratchet:")
    for (const l of fails) console.error("  " + l)
  }
  if (stale.length && !args.writeDown) {
    console.error(
      "🔴 stale baseline (shrink/drop not recorded). Re-run with --update-baseline and commit:",
    )
    for (const l of stale) console.error("  " + l)
  }
  if (stale.length && args.writeDown && fails.length === 0) {
    fs.writeFileSync(baselinePath, JSON.stringify({ ...baselineDoc, files: next }, null, 2) + "\n")
    console.log(`wrote-down ${baselinePath}`)
  }
  if (fails.length === 0 && (stale.length === 0 || args.writeDown)) {
    console.log("✅ size/impurity ratchet: no growth")
    return 0
  }
  return 1
}

function main() {
  process.exit(runLint(process.argv.slice(2)))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}

export { concernInfixOk, effectiveBudget, metricOf, purityClass, runLint }
