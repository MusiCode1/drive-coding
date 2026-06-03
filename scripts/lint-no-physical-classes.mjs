#!/usr/bin/env node
// @ts-check
/**
 * Block physical (direction-aware) Tailwind classes and CSS properties in .svelte files.
 *
 * RTL-clean code uses logical properties (`ps-*`, `pe-*`, `ms-*`, `me-*`,
 * `border-s`, `border-e`, `rounded-s-*`, `rounded-e-*`, `inset-inline-start`
 * etc.) so the layout flips correctly when `<html dir>` changes between ltr/rtl.
 *
 * Exit 0 = clean. Exit 1 = violations found.
 *
 * Scope: packages/frontend/src/**\/*.svelte
 *
 * What is checked:
 *   1. Tailwind physical classes (in class= / class: attributes):
 *      pl-*, pr-*, ml-*, mr-*, border-l-*, border-r-*, rounded-l-*, rounded-r-*,
 *      rounded-tl-*, rounded-tr-*, rounded-bl-*, rounded-br-*,
 *      text-left, text-right.
 *
 *   2. CSS physical properties (inside <style> blocks):
 *      padding-left, padding-right, margin-left, margin-right,
 *      border-left, border-right, float: left, float: right.
 *
 * Allow-list (these are intentional and OK):
 *   - Tailwind: left-1/2, right-1/2 (centering utilities — symmetric, direction-neutral).
 *   - CSS: lines containing the comment  rtl-allow  (inline opt-out for visual toggles etc.).
 *
 * Run from repo root:
 *   node scripts/lint-no-physical-classes.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const SCAN_DIR = join(REPO_ROOT, "packages/frontend/src")

// ── Tailwind physical class patterns ────────────────────────────────────────

/** Physical classes that violate the no-physical rule. */
const TAILWIND_PHYSICAL_RE =
  /\b(pl|pr|ml|mr|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)-\S+|\btext-(left|right)\b/g

/**
 * Allow-list: matches that are OK even though they look like physical.
 * left-1/2 and right-1/2 are centering utilities (symmetric, not dir-dependent).
 */
const TAILWIND_ALLOW_RE = /^(left-1\/2|right-1\/2)$/

// ── CSS physical property patterns ──────────────────────────────────────────

const CSS_PHYSICAL_RE =
  /\b(padding-left|padding-right|margin-left|margin-right|border-left|border-right)\b|float\s*:\s*(left|right)/g

// ── File walking ─────────────────────────────────────────────────────────────

/**
 * Recursively collect .svelte files under `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function walkSvelte(dir) {
  /** @type {string[]} */
  const found = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".svelte-kit" || entry.name === "dist") {
        continue
      }
      found.push(...walkSvelte(full))
    } else if (entry.isFile() && entry.name.endsWith(".svelte")) {
      found.push(full)
    }
  }
  return found
}

// ── Per-file scanning ────────────────────────────────────────────────────────

/**
 * Extract `<style>` block content with its start line offset.
 * Returns {content, startLine} or null if no <style> block.
 * @param {string} text
 * @returns {{ content: string; startLine: number } | null}
 */
function extractStyleBlock(text) {
  const styleMatch = text.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  if (!styleMatch || styleMatch[1] === undefined) return null
  const startLine = text.slice(0, styleMatch.index).split("\n").length
  return { content: styleMatch[1], startLine }
}

/**
 * Scan a single file and return violations.
 * @param {string} absPath
 * @returns {Array<{ lineNo: number; kind: "tailwind" | "css"; match: string; line: string }>}
 */
function scanFile(absPath) {
  let text
  try {
    text = readFileSync(absPath, "utf-8")
  } catch {
    return []
  }

  /** @type {Array<{ lineNo: number; kind: "tailwind" | "css"; match: string; line: string }>} */
  const violations = []

  const lines = text.split("\n")

  // ── 1. Tailwind physical classes (scan all lines for class= / class:) ──────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    // Skip lines inside <style> blocks — those are handled separately
    // (simple heuristic: skip if line looks like CSS-only content)
    // We scan the whole file; CSS false-positives are caught in the next block.

    // Reset lastIndex before exec loop
    TAILWIND_PHYSICAL_RE.lastIndex = 0
    let m
    while ((m = TAILWIND_PHYSICAL_RE.exec(line)) !== null) {
      const matched = m[0]
      if (TAILWIND_ALLOW_RE.test(matched)) continue
      violations.push({ lineNo: i + 1, kind: "tailwind", match: matched, line: line.trim() })
    }
  }

  // ── 2. CSS physical properties (only inside <style> blocks) ─────────────────
  const styleBlock = extractStyleBlock(text)
  if (styleBlock) {
    const styleLines = styleBlock.content.split("\n")
    for (let i = 0; i < styleLines.length; i++) {
      const line = styleLines[i]
      if (!line) continue
      // Inline opt-out
      if (line.includes("rtl-allow")) continue
      CSS_PHYSICAL_RE.lastIndex = 0
      let m
      while ((m = CSS_PHYSICAL_RE.exec(line)) !== null) {
        violations.push({
          lineNo: styleBlock.startLine + i,
          kind: "css",
          match: m[0],
          line: line.trim(),
        })
      }
    }
  }

  return violations
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  let totalViolations = 0
  /** @type {Array<[string, ReturnType<typeof scanFile>]>} */
  const badFiles = []

  let scanRoot
  try {
    if (!statSync(SCAN_DIR).isDirectory()) {
      process.stderr.write(`lint-no-physical-classes: ${SCAN_DIR} is not a directory\n`)
      return 2
    }
    scanRoot = SCAN_DIR
  } catch {
    process.stderr.write(`lint-no-physical-classes: ${SCAN_DIR} not found\n`)
    return 2
  }

  for (const absPath of walkSvelte(scanRoot)) {
    const v = scanFile(absPath)
    if (v.length > 0) {
      badFiles.push([absPath, v])
      totalViolations += v.length
    }
  }

  if (badFiles.length > 0) {
    process.stderr.write("Physical direction classes/properties found (use logical equivalents):\n\n")
    for (const [absPath, violations] of badFiles) {
      const rel = relative(REPO_ROOT, absPath).split("\\").join("/")
      process.stderr.write(`  ${rel}\n`)
      for (const { lineNo, kind, match, line } of violations) {
        process.stderr.write(`    ${lineNo}: [${kind}] "${match}"  →  ${line}\n`)
      }
      process.stderr.write("\n")
    }
    process.stderr.write(
      `✗ ${badFiles.length} file(s), ${totalViolations} violation(s).\n\n`,
    )
    process.stderr.write(
      "Fix: replace physical classes (pl-*, pr-*, ml-*, mr-*, border-l/r-*, rounded-l/r-*)\n",
    )
    process.stderr.write(
      "  with Tailwind logical equivalents (ps-*, pe-*, ms-*, me-*, border-s/e-*, rounded-s/e-*).\n",
    )
    process.stderr.write(
      "  For CSS: use padding-inline-start/end, margin-inline-start/end, border-inline-*.\n",
    )
    process.stderr.write("  To allow a specific line: add  /* rtl-allow */  as a comment.\n")
    return 1
  }

  process.stdout.write("✓ No physical direction classes/properties found.\n")
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}

export { scanFile, walkSvelte }
