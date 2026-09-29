import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildKnownIssuesDocument } from "./gen-known-issues.mjs"

const SCRIPT = path.resolve(import.meta.dirname, "gen-known-issues.mjs")
let lab

function seedCore(root, version = "1.3.0") {
  const coreDir = path.join(root, "packages/core/src/docs")
  mkdirSync(coreDir, { recursive: true })
  writeFileSync(
    path.join(coreDir, "index.ts"),
    `export const DOCS_VERSION = "${version}"\n`,
    "utf8",
  )
}

function runCli(root) {
  const r = spawnSync("node", [SCRIPT, root], { encoding: "utf8" })
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

beforeEach(() => {
  lab = mkdtempSync(path.join(os.tmpdir(), "gen-known-issues-"))
  seedCore(lab)
})

afterEach(() => {
  rmSync(lab, { recursive: true, force: true })
})

describe("fail-open — silence before success paths", () => {
  it("1 — --root without docs-for-llm: exit 0, empty stdout, no file", () => {
    const r = runCli(lab)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
    expect(existsSync(path.join(lab, "docs/agents/99-known-issues.md"))).toBe(false)
  })

  it("2 — docs-for-llm without bugs/: exit 0, empty stdout", () => {
    mkdirSync(path.join(lab, "docs-for-llm"), { recursive: true })
    const r = runCli(lab)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
  })

  it("3 — broken docs-for-llm symlink: exit 0, empty stdout", () => {
    symlinkSync(path.join(lab, "missing-bugs-tree"), path.join(lab, "docs-for-llm"))
    const r = runCli(lab)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
  })
})

describe("generator output", () => {
  function bugsDir() {
    return path.join(lab, "docs-for-llm/bugs")
  }

  beforeEach(() => {
    mkdirSync(bugsDir(), { recursive: true })
  })

  it("4 — writes synthetic example only when no marked issues", () => {
    const r = runCli(lab)
    expect(r.code).toBe(0)
    const text = readFileSync(path.join(lab, "docs/agents/99-known-issues.md"), "utf8")
    expect(text).toContain("#EXAMPLE")
    expect(text.match(/#EXAMPLE/g)?.length).toBe(1)
    expect(text).not.toMatch(/#74/)
  })

  it("5 — marked issue skipped when publication disabled", () => {
    writeFileSync(
      path.join(bugsDir(), "99-sample.md"),
      `---
id: "#99"
date: 2026-01-01
area: infra
reported_by: agent
severity: minor
public_summary_en: "Sample published summary for tests."
---
body
`,
      "utf8",
    )
    const r = runCli(lab)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain("skipped 1 marked issue(s) — publication disabled")
    const text = readFileSync(path.join(lab, "docs/agents/99-known-issues.md"), "utf8")
    expect(text).not.toContain("#99")
    expect(text).toContain("#EXAMPLE")
  })

  it("6 — publishes marked issue when publish flag on", () => {
    writeFileSync(
      path.join(bugsDir(), "88-live.md"),
      `---
id: "#88"
date: 2026-01-01
area: be
reported_by: agent
severity: major
public_summary_en: "Backend returns stale catalog when index drifts."
---
`,
      "utf8",
    )
    const { markdown } = buildKnownIssuesDocument(lab, { publish: true })
    expect(markdown).toContain("#88")
    expect(markdown).toContain("Backend returns stale catalog")
    expect(markdown).toContain("| open |")
  })

  it("7 — archive directory yields closed status", () => {
    mkdirSync(path.join(bugsDir(), "archive"), { recursive: true })
    writeFileSync(
      path.join(bugsDir(), "archive/77-closed.md"),
      `---
id: "#77"
date: 2026-01-01
area: core
reported_by: agent
severity: minor
public_summary_en: "Resolved race in session teardown."
---
`,
      "utf8",
    )
    const { markdown } = buildKnownIssuesDocument(lab, { publish: true })
    expect(markdown).toContain("#77")
    expect(markdown).toContain("| closed |")
  })

  it("8 — Hebrew public_summary_en with publish on: exit 1, no file", () => {
    writeFileSync(
      path.join(bugsDir(), "hebrew.md"),
      `---
id: "#HE"
date: 2026-01-01
area: fe
reported_by: agent
severity: minor
public_summary_en: "תקלה בעברית"
---
`,
      "utf8",
    )
    expect(() => buildKnownIssuesDocument(lab, { publish: true })).toThrow(/#HE/)
    const out = path.join(lab, "docs/agents/99-known-issues.md")
    expect(existsSync(out)).toBe(false)
  })

  it("9 — deterministic output on two runs", () => {
    writeFileSync(
      path.join(bugsDir(), "b.md"),
      `---
id: "#B"
date: 2026-01-01
area: be
reported_by: agent
severity: minor
---
`,
      "utf8",
    )
    const a = buildKnownIssuesDocument(lab).markdown
    const b = buildKnownIssuesDocument(lab).markdown
    expect(a).toBe(b)
  })

  it("10 — missing affects_version renders empty cell", () => {
    const { markdown } = buildKnownIssuesDocument(lab)
    expect(markdown).toMatch(/\| `#EXAMPLE` \| example \| minor \| open \| .+ \| {2}\|/)
  })

  it("11 — README and _TEMPLATE excluded even with public_summary_en", () => {
    writeFileSync(
      path.join(bugsDir(), "README.md"),
      `---
id: "#R"
area: infra
severity: minor
public_summary_en: "Should never publish"
---
`,
      "utf8",
    )
    writeFileSync(
      path.join(bugsDir(), "_TEMPLATE.md"),
      `---
id: "#T"
area: infra
severity: minor
public_summary_en: "Template must not publish"
---
`,
      "utf8",
    )
    const { markdown, reports } = buildKnownIssuesDocument(lab, { publish: true })
    expect(markdown).not.toContain("#R")
    expect(markdown).not.toContain("#T")
    expect(reports.join("\n")).not.toContain("Should never publish")
  })

  it("12 — bug without front matter is skipped and reported", () => {
    writeFileSync(path.join(bugsDir(), "no-fm.md"), "# just a heading\n", "utf8")
    const { reports } = buildKnownIssuesDocument(lab)
    expect(reports.some((r) => r.includes("without front matter"))).toBe(true)
  })

  it("13 — invalid area/severity skipped with filename", () => {
    writeFileSync(
      path.join(bugsDir(), "bad-meta.md"),
      `---
id: "#BAD"
area: not-an-area
severity: tiny
public_summary_en: "Never shown"
---
`,
      "utf8",
    )
    const { markdown, reports } = buildKnownIssuesDocument(lab, { publish: true })
    expect(markdown).not.toContain("#BAD")
    expect(reports.some((r) => r.includes("bad-meta.md"))).toBe(true)
  })
})
