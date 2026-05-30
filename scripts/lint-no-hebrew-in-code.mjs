#!/usr/bin/env node
// @ts-check
/**
 * Block hardcoded Hebrew strings in source code.
 *
 * Scans TS + Svelte files for Hebrew characters (U+0590..U+05FF) that appear
 * inside string literals (single/double/backtick quotes) or Svelte template
 * text. Hebrew inside line comments (`//`) and block comments (`/* *​/`) is
 * allowed — those are developer notes.
 *
 * Scope:
 *   - packages/frontend/
 *   - packages/core/
 *   - packages/backend/
 *
 * Allowlist (paths where Hebrew IS allowed in strings):
 *   - packages/core/src/i18n/catalogs/*  (source of truth)
 *   - packages/core/src/voice/*-prompt.ts  (LLM prompts)
 *   - **​/*.test.ts, **​/tests/**, **​/fixtures/**  (test data)
 *
 * Exit 0 = clean. Exit 1 = violations found.
 *
 * Pure Node stdlib (fs/path) — no dependencies, no build step. Runs via the
 * `.sh` wrapper which prefers this over the legacy Python implementation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const SCAN_DIRS = ["packages/frontend", "packages/core", "packages/backend"]

/** Paths (matched against the POSIX-style relative path) where Hebrew IS allowed. */
const ALLOW_PATTERNS = [
  /packages\/core\/src\/i18n\/catalogs\//,
  /\/voice\/.*-prompt\.ts$/,
  /packages\/backend\/src\/prompts\//, // LLM system prompts (slice 14)
  /\.test\.ts$/,
  /\/tests\//,
  /\/fixtures\//,
  /\/node_modules\//,
  /\/build\//,
  /\/\.svelte-kit\//,
  /\/dist\//,
]

const HEBREW_RE = /[\u0590-\u05FF]/

/**
 * @param {string} absPath
 * @returns {boolean}
 */
function isAllowed(absPath) {
  // Normalise to POSIX separators so the allow patterns match on every OS.
  const rel = relative(REPO_ROOT, absPath).split("\\").join("/")
  return ALLOW_PATTERNS.some((p) => p.test(rel))
}

/**
 * Pre-pass: blank out all `/​** ... *​/`, `/​* ... *​/`, and `<!-- ... -->` blocks.
 * Done before the main state machine so regex literals containing quotes
 * (`/.../`) don't confuse comment detection. Preserves line breaks.
 *
 * @param {string} text
 * @returns {string}
 */
function stripJsdocBlocks(text) {
  const out = [...text]
  const n = text.length
  let i = 0
  while (i < n - 1) {
    if (text[i] === "/" && text[i + 1] === "*") {
      let end = text.indexOf("*/", i + 2)
      end = end === -1 ? n : end + 2
      for (let j = i; j < end; j++) {
        if (out[j] !== "\n") out[j] = " "
      }
      i = end
    } else if (i < n - 3 && text.slice(i, i + 4) === "<!--") {
      let end = text.indexOf("-->", i + 4)
      end = end === -1 ? n : end + 3
      for (let j = i; j < end; j++) {
        if (out[j] !== "\n") out[j] = " "
      }
      i = end
    } else {
      i += 1
    }
  }
  return out.join("")
}

/**
 * Characters that, as the last significant token before a `/`, mean the `/`
 * starts a regex literal (not a division operator). After an identifier,
 * number, `)`, or `]` a `/` is division, so we leave it as code.
 */
const REGEX_PREV_CHARS = new Set("(,=:[!&|?{};+-*%<>~^")

/**
 * Last non-whitespace char already emitted to `out` (or '' at start).
 * @param {string[]} out
 * @returns {string}
 */
function prevSignificant(out) {
  for (let k = out.length - 1; k >= 0; k--) {
    const c = out[k]
    if (c !== " " && c !== "\t" && c !== "\r" && c !== "\n") return c
  }
  return ""
}

/**
 * Walk the full file as a single character stream with a state machine.
 * Replace every comment character with a space, preserving line breaks.
 * Strings are preserved as-is.
 *
 * States: code | line_comment | str_dq | str_sq | str_bt | regex
 * (Block comments are handled in stripJsdocBlocks before this.)
 *
 * Regex literals (`/.../flags`) are tracked so that quote characters inside
 * them (e.g. `/"message":"..."/`) don't open a phantom string state and
 * swallow the Hebrew comments that follow.
 *
 * @param {string} input
 * @returns {string}
 */
function stripAllComments(input) {
  const text = stripJsdocBlocks(input)
  /** @type {string[]} */
  const out = []
  /** @type {"code"|"line_comment"|"str_dq"|"str_sq"|"str_bt"|"regex"} */
  let state = "code"
  let inCharClass = false // inside [...] within a regex
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    const nxt = i + 1 < n ? text[i + 1] : ""
    if (state === "code") {
      if (ch === "/" && nxt === "/") {
        out.push("  ")
        state = "line_comment"
        i += 2
        continue
      }
      if (ch === "/" && REGEX_PREV_CHARS.has(prevSignificant(out))) {
        state = "regex"
        inCharClass = false
        out.push(ch)
        i += 1
        continue
      }
      if (ch === '"') state = "str_dq"
      else if (ch === "'") state = "str_sq"
      else if (ch === "`") state = "str_bt"
      out.push(ch)
      i += 1
      continue
    }
    if (state === "line_comment") {
      if (ch === "\n") {
        out.push("\n")
        state = "code"
      } else {
        out.push(" ")
      }
      i += 1
      continue
    }
    if (state === "regex") {
      if (ch === "\\" && i + 1 < n) {
        out.push(ch)
        out.push(text[i + 1])
        i += 2
        continue
      }
      if (ch === "[") inCharClass = true
      else if (ch === "]") inCharClass = false
      else if (ch === "/" && !inCharClass) state = "code"
      else if (ch === "\n") state = "code" // unterminated regex — bail to code
      out.push(ch)
      i += 1
      continue
    }
    // In a string literal: handle escapes, preserve text.
    const quote = state === "str_dq" ? '"' : state === "str_sq" ? "'" : "`"
    if (ch === "\\" && i + 1 < n) {
      out.push(ch)
      out.push(text[i + 1])
      i += 2
      continue
    }
    if (ch === quote) {
      out.push(ch)
      state = "code"
      i += 1
      continue
    }
    out.push(ch)
    i += 1
  }
  return out.join("")
}

/**
 * Return list of [lineNo, originalLine] where Hebrew appears outside comments.
 * @param {string} absPath
 * @returns {Array<[number, string]>}
 */
function scanFile(absPath) {
  let text
  try {
    text = readFileSync(absPath, "utf-8")
  } catch {
    return []
  }
  const codeOnly = stripAllComments(text)
  /** @type {Array<[number, string]>} */
  const violations = []
  const originalLines = text.split("\n")
  const codeLines = codeOnly.split("\n")
  const count = Math.min(originalLines.length, codeLines.length)
  for (let idx = 0; idx < count; idx++) {
    if (HEBREW_RE.test(codeLines[idx])) {
      violations.push([idx + 1, originalLines[idx].replace(/\s+$/, "")])
    }
  }
  return violations
}

/**
 * Recursively collect files with the given extensions under `dir`.
 * @param {string} dir
 * @param {string[]} exts
 * @returns {string[]}
 */
function walk(dir, exts) {
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
      found.push(...walk(full, exts))
    } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
      found.push(full)
    }
  }
  return found
}

function main() {
  let totalViolations = 0
  /** @type {Array<[string, Array<[number, string]>]>} */
  const badFiles = []

  for (const d of SCAN_DIRS) {
    const root = join(REPO_ROOT, d)
    try {
      if (!statSync(root).isDirectory()) continue
    } catch {
      continue
    }
    for (const path of walk(root, [".ts", ".svelte"])) {
      if (isAllowed(path)) continue
      const v = scanFile(path)
      if (v.length > 0) {
        badFiles.push([path, v])
        totalViolations += v.length
      }
    }
  }

  if (badFiles.length > 0) {
    process.stderr.write("Hebrew strings found in code (must use t('key') instead):\n\n")
    for (const [path, violations] of badFiles) {
      const rel = relative(REPO_ROOT, path).split("\\").join("/")
      process.stderr.write(`  ${rel}\n`)
      for (const [lineNo, line] of violations) {
        process.stderr.write(`    ${lineNo}: ${line}\n`)
      }
      process.stderr.write("\n")
    }
    process.stderr.write(`✗ ${badFiles.length} file(s), ${totalViolations} occurrence(s).\n\n`)
    process.stderr.write("Fix: add the string to packages/core/src/i18n/catalogs/{he,en}.ts,\n")
    process.stderr.write("  add the key to packages/core/src/i18n/keys.ts,\n")
    process.stderr.write("  and use t('your.key') in the component.\n")
    return 1
  }

  process.stdout.write("✓ No hardcoded Hebrew in code.\n")
  return 0
}

// Only run + exit when invoked directly (node lint-no-hebrew-in-code.mjs),
// so test files can import the helpers below without triggering a process exit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}

// Exported for tests.
export { stripAllComments, stripJsdocBlocks, scanFile, isAllowed, HEBREW_RE, main }
