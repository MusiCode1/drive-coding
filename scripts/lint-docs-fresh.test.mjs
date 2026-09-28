import { execFileSync, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runFreshnessChecks } from "./lint-docs-fresh.mjs"

const SCRIPT = path.resolve(import.meta.dirname, "lint-docs-fresh.mjs")
const REPO = path.resolve(import.meta.dirname, "..")

let lab

function runCli(cwd, args = [], stdin = null) {
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    input: stdin ?? undefined,
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function seedDocsTree(root) {
  mkdirSync(path.join(root, "docs-for-llm/bugs"), { recursive: true })
  mkdirSync(path.join(root, "docs/agents"), { recursive: true })
  mkdirSync(path.join(root, "packages/core/src/docs"), { recursive: true })
  writeFileSync(
    path.join(root, "packages/core/src/docs/index.ts"),
    'export const DOCS_VERSION = "1.0.0"\n',
    "utf8",
  )
  writeFileSync(
    path.join(root, "docs/agents/openapi.json"),
    JSON.stringify({ openapi: "3.1.1", info: { version: "1.0.0" }, paths: {} }, null, 2),
    "utf8",
  )
}

beforeEach(() => {
  lab = mkdtempSync(path.join(os.tmpdir(), "lint-docs-fresh-"))
})

afterEach(() => {
  rmSync(lab, { recursive: true, force: true })
})

describe("fail-open — silence before failure paths", () => {
  it("1 — missing docs-for-llm", () => {
    const r = runCli(lab, ["--root", lab])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
    expect(r.stderr).toBe("")
  })

  it("1b — docs-for-llm without bugs/", () => {
    mkdirSync(path.join(lab, "docs-for-llm"), { recursive: true })
    const r = runCli(lab, ["--root", lab])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
  })

  it("2 — not a git repository", () => {
    seedDocsTree(lab)
    const r = runCli(lab, ["--root", lab])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
  })

  it("3 — range cannot be derived", () => {
    seedDocsTree(lab)
    execFileSync("git", ["init"], { cwd: lab })
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: lab })
    execFileSync("git", ["config", "user.name", "t"], { cwd: lab })
    writeFileSync(path.join(lab, "README"), "x", "utf8")
    execFileSync("git", ["add", "README"], { cwd: lab })
    execFileSync("git", ["commit", "-m", "init"], { cwd: lab })
    const r = runCli(lab, ["--root", lab])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
  })
})

describe("freshness failures and anti-mutations", () => {
  beforeEach(() => {
    seedDocsTree(lab)
    execFileSync("git", ["init"], { cwd: lab })
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: lab })
    execFileSync("git", ["config", "user.name", "t"], { cwd: lab })
    writeFileSync(path.join(lab, "README"), "init", "utf8")
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "base"], { cwd: lab })
  })

  it("7 — agent doc changed without DOCS_VERSION bump fails", () => {
    writeFileSync(
      path.join(lab, "docs/agents/10-a.md"),
      `---
id: a
title: A
summary: Enough summary text here
read_when:
  - Trigger one here
  - Trigger two here
tags: [x]
surface: [http]
stability: stable
docs_version: 1.0.0
updated: 2026-01-01
---
`,
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "doc"], { cwd: lab })
    const base = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: lab, encoding: "utf8" }).trim()
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: lab, encoding: "utf8" }).trim()
    const { fails } = runFreshnessChecks(lab, `${base}..${head}`)
    expect(fails.some((f) => f.includes("DOCS_VERSION"))).toBe(true)
  })

  it("7c — index.md only change is ignored", () => {
    writeFileSync(path.join(lab, "docs/agents/index.md"), "# index\n", "utf8")
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "index"], { cwd: lab })
    const base = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: lab, encoding: "utf8" }).trim()
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: lab, encoding: "utf8" }).trim()
    const { fails } = runFreshnessChecks(lab, `${base}..${head}`)
    expect(fails.filter((f) => f.includes("DOCS_VERSION"))).toHaveLength(0)
  })

  it("10 — publication off forbids real bug ids in known-issues", () => {
    writeFileSync(
      path.join(lab, "docs/agents/99-known-issues.md"),
      "| `#74` | infra | major | open | x |  |\n",
      "utf8",
    )
    const { fails } = runFreshnessChecks(lab, "HEAD~0..HEAD")
    expect(fails.some((f) => f.includes("#74"))).toBe(true)
  })
})

describe("lint-docs-fresh on slice worktree", () => {
  it("passes explicit slice range", () => {
    if (!existsSync(path.join(REPO, "docs-for-llm"))) return
    const r = runCli(REPO, ["--range", "40aca861..HEAD"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("docs-freshness")
  })

  it("wide range skips four known-undocumented surfaces with notice", () => {
    if (!existsSync(path.join(REPO, "docs-for-llm"))) return
    const { fails, undocumentedSkipped } = runFreshnessChecks(REPO, "092439d8..HEAD")
    expect(fails).toHaveLength(0)
    expect(undocumentedSkipped).toBe(4)
    const r = runCli(REPO, ["--range", "092439d8..HEAD"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("4 known-undocumented surface(s) skipped")
  })
})

describe("KNOWN_UNDOCUMENTED is not a silence switch", () => {
  beforeEach(() => {
    seedDocsTree(lab)
    mkdirSync(path.join(lab, "packages/backend/src/delivery"), { recursive: true })
    writeFileSync(
      path.join(lab, "packages/backend/src/delivery/routes-lab.ts"),
      `import { Hono } from "hono"
const app = new Hono()
app.get("/api/zzz", (c) => c.text("z"))
export { app }
`,
      "utf8",
    )
    mkdirSync(path.join(lab, "packages/core/src/schemas"), { recursive: true })
    writeFileSync(
      path.join(lab, "packages/core/src/schemas/mcp-docs.ts"),
      `export type McpToolName = "session_list"
`,
      "utf8",
    )
    mkdirSync(path.join(lab, "packages/core/src/config"), { recursive: true })
    writeFileSync(
      path.join(lab, "packages/core/src/config/specs.ts"),
      "export const CONFIG_SPECS = []\n",
      "utf8",
    )
    execFileSync("git", ["init"], { cwd: lab })
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: lab })
    execFileSync("git", ["config", "user.name", "t"], { cwd: lab })
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "base"], { cwd: lab })
  })

  it("14 — new route outside KNOWN_UNDOCUMENTED still fails", () => {
    writeFileSync(
      path.join(lab, "packages/backend/src/delivery/routes-lab.ts"),
      `import { Hono } from "hono"
const app = new Hono()
app.get("/api/zzz", (c) => c.text("z"))
app.get("/api/new-route", (c) => c.text("n"))
export { app }
`,
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "route"], { cwd: lab })
    const base = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: lab, encoding: "utf8" }).trim()
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: lab, encoding: "utf8" }).trim()
    const { fails } = runFreshnessChecks(lab, `${base}..${head}`)
    expect(
      fails.some((f) => f.includes("GET /api/new-route") || f.includes("get /api/new-route")),
    ).toBe(true)
  })
})
