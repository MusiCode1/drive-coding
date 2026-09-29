import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

function writeOwnerStub(root, fileName, id) {
  writeFileSync(
    path.join(root, "docs/agents", fileName),
    `---
id: ${id}
title: Owner document title
summary: Summary with enough characters for validation gates to pass
read_when:
  - First trigger phrase for read_when list
  - Second trigger phrase for read_when list
tags: [known-issues]
surface: [http]
stability: stable
docs_version: 1.0.0
updated: 2026-01-01
---
Body.
`,
    "utf8",
  )
}

function gitInitCommit(root, message = "base") {
  execFileSync("git", ["init"], { cwd: root })
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root })
  execFileSync("git", ["config", "user.name", "t"], { cwd: root })
  writeFileSync(path.join(root, "README"), "init", "utf8")
  execFileSync("git", ["add", "."], { cwd: root })
  execFileSync("git", ["commit", "-m", message], { cwd: root })
}

function lastRange(root) {
  const base = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: root, encoding: "utf8" }).trim()
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  return `${base}..${head}`
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
    expect(r.stderr).toBe("")
  })

  it("2 — not a git repository", () => {
    seedDocsTree(lab)
    const r = runCli(lab, ["--root", lab])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
    expect(r.stderr).toBe("")
  })

  it("3 — range cannot be derived", () => {
    seedDocsTree(lab)
    gitInitCommit(lab, "init")
    const r = runCli(lab, ["--root", lab])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
    expect(r.stderr).toBe("")
  })

  it("4 — internal error (corrupt openapi) exits 0", () => {
    seedDocsTree(lab)
    gitInitCommit(lab, "init")
    writeFileSync(path.join(lab, "docs/agents/openapi.json"), "{not-json", "utf8")
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: lab, encoding: "utf8" }).trim()
    const r = runCli(lab, ["--root", lab, "--range", `${sha}..${sha}`])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("")
  })
})

describe("§8.3 lint table — failures and anti-mutations", () => {
  beforeEach(() => {
    seedDocsTree(lab)
    gitInitCommit(lab, "base")
  })

  it("5 — new route without owning document fails", () => {
    mkdirSync(path.join(lab, "packages/backend/src/delivery"), { recursive: true })
    mkdirSync(path.join(lab, "packages/core/src/schemas"), { recursive: true })
    writeFileSync(
      path.join(lab, "packages/core/src/schemas/mcp-docs.ts"),
      'export type McpToolName = "session_list"\n',
      "utf8",
    )
    writeFileSync(
      path.join(lab, "packages/backend/src/delivery/routes-lab.ts"),
      `import { Hono } from "hono"
const app = new Hono()
app.get("/api/new-route", (c) => c.text("n"))
export { app }
`,
      "utf8",
    )
    writeFileSync(
      path.join(lab, "docs/agents/openapi.json"),
      JSON.stringify(
        {
          openapi: "3.1.1",
          info: { version: "1.0.0" },
          paths: { "/api/new-route": { get: {} } },
        },
        null,
        2,
      ),
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "route"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("no document declares GET /api/new-route"))).toBe(true)
  })

  it("6 — route line moved only stays green", () => {
    mkdirSync(path.join(lab, "packages/backend/src/delivery"), { recursive: true })
    writeFileSync(
      path.join(lab, "docs/agents/openapi.json"),
      JSON.stringify(
        {
          openapi: "3.1.1",
          info: { version: "1.0.0" },
          paths: { "/api/foo": { get: {} } },
        },
        null,
        2,
      ),
      "utf8",
    )
    writeFileSync(
      path.join(lab, "docs/agents/10-foo-route.md"),
      `---
id: foo-route
title: Foo route owner document title
summary: Summary with enough characters for validation gates to pass
read_when:
  - First trigger phrase for read_when list
  - Second trigger phrase for read_when list
tags: [http]
surface: [http]
stability: stable
docs_version: 1.0.0
updated: 2026-01-01
routes:
  - GET /api/foo
---
Body.
`,
      "utf8",
    )
    writeFileSync(
      path.join(lab, "packages/backend/src/delivery/routes-lab.ts"),
      `import { Hono } from "hono"
const app = new Hono()
app.get("/api/foo", (c) => c.text("x"))
export { app }
`,
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "route"], { cwd: lab })
    writeFileSync(
      path.join(lab, "packages/backend/src/delivery/routes-lab.ts"),
      `import { Hono } from "hono"
const app = new Hono()
app.get( "/api/foo", (c) => c.text("x"))
export { app }
`,
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "move"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails).toHaveLength(0)
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
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("DOCS_VERSION"))).toBe(true)
  })

  it("7b — DOCS_VERSION absent at range base stays green", () => {
    writeFileSync(path.join(lab, "packages/core/src/docs/index.ts"), "export {}\n", "utf8")
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "no-version"], { cwd: lab })
    writeFileSync(
      path.join(lab, "packages/core/src/docs/index.ts"),
      'export const DOCS_VERSION = "1.0.0"\n',
      "utf8",
    )
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
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.filter((f) => f.includes("DOCS_VERSION"))).toHaveLength(0)
  })

  it("7c — index.md only change is ignored", () => {
    writeFileSync(path.join(lab, "docs/agents/index.md"), "# index\n", "utf8")
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "index"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.filter((f) => f.includes("DOCS_VERSION"))).toHaveLength(0)
  })

  it("8 — derived index.json change alone stays green", () => {
    writeFileSync(
      path.join(lab, "docs/agents/index.json"),
      JSON.stringify({ docsVersion: "1.0.0", docs: [] }, null, 2),
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "index-json"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails).toHaveLength(0)
  })

  it("9 — openapi info.version mismatch fails", () => {
    writeFileSync(
      path.join(lab, "docs/agents/openapi.json"),
      JSON.stringify({ openapi: "3.1.1", info: { version: "9.9.9" }, paths: {} }, null, 2),
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "openapi"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("info.version"))).toBe(true)
  })

  it("10 — publication off forbids real bug ids in known-issues", () => {
    writeFileSync(
      path.join(lab, "docs/agents/99-known-issues.md"),
      "| `#74` | infra | major | open | x |  |\n",
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "known"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("#74"))).toBe(true)
  })

  it("11 — publication on requires marked bugs in known-issues", () => {
    writeFileSync(
      path.join(lab, "docs-for-llm/bugs/88-live.md"),
      `---
id: "#88"
date: 2026-01-01
area: be
reported_by: agent
severity: minor
public_summary_en: "Published issue summary for tests."
---
`,
      "utf8",
    )
    writeFileSync(
      path.join(lab, "docs/agents/99-known-issues.md"),
      "| `#EXAMPLE` | x | x | open | x |  |\n",
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "bugs"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab), { publish: true })
    expect(fails.some((f) => f.includes("#88"))).toBe(true)
  })
})

describe("§5.1 map rows 3–5 — owner doc must update in range", () => {
  beforeEach(() => {
    seedDocsTree(lab)
    mkdirSync(path.join(lab, "packages/core/src/ui"), { recursive: true })
    mkdirSync(path.join(lab, "packages/core/src/config"), { recursive: true })
    mkdirSync(path.join(lab, "packages/frontend/src/routes/lab"), { recursive: true })
    writeOwnerStub(lab, "45-render-contract.md", "render-contract")
    writeOwnerStub(lab, "46-ui-reference.md", "ui-reference")
    writeOwnerStub(lab, "92-diagnostics.md", "diagnostics")
    writeFileSync(
      path.join(lab, "packages/core/src/ui/markdown.ts"),
      "export const MARKDOWN = 1\n",
      "utf8",
    )
    writeFileSync(
      path.join(lab, "packages/core/src/config/specs.ts"),
      `export const CONFIG_SPECS = [
  {
    key: "port",
    env: "PORT",
  },
]
`,
      "utf8",
    )
    writeFileSync(
      path.join(lab, "packages/frontend/src/routes/lab/+page.svelte"),
      "<script></script>\n",
      "utf8",
    )
    gitInitCommit(lab, "base")
  })

  it("3 — render contract change without owner update fails", () => {
    writeFileSync(
      path.join(lab, "packages/core/src/ui/markdown.ts"),
      "export const MARKDOWN = 2\n",
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "markdown"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(
      fails.some((f) => f.includes("45-render-contract.md") && f.includes("not updated")),
    ).toBe(true)
  })

  it("12 — +page.svelte modified (M) stays green", () => {
    writeFileSync(
      path.join(lab, "packages/frontend/src/routes/lab/+page.svelte"),
      "<script>let x = 1</script>\n",
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "page-m"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails).toHaveLength(0)
  })

  it("13 — +page.svelte added without ui-reference update fails", () => {
    mkdirSync(path.join(lab, "packages/frontend/src/routes/new-page"), { recursive: true })
    writeFileSync(
      path.join(lab, "packages/frontend/src/routes/new-page/+page.svelte"),
      "<script></script>\n",
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "page-a"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("46-ui-reference.md") && f.includes("not updated"))).toBe(
      true,
    )
  })

  it("5 — new config key (multiline entry) without diagnostics update fails", () => {
    writeFileSync(
      path.join(lab, "packages/core/src/config/specs.ts"),
      `export const CONFIG_SPECS = [
  {
    key: "port",
    env: "PORT",
  },
  {
    key: "newKey",
    env: "NEW_KEY",
  },
]
`,
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "config-multiline"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("92-diagnostics.md") && f.includes("not updated"))).toBe(
      true,
    )
  })

  it("5b — new config key (single-line entry) without diagnostics update fails", () => {
    writeFileSync(
      path.join(lab, "packages/core/src/config/specs.ts"),
      `export const CONFIG_SPECS = [
  {
    key: "port",
    env: "PORT",
  },
  { key: "inlineKey", env: "INLINE_KEY" },
]
`,
      "utf8",
    )
    execFileSync("git", ["add", "."], { cwd: lab })
    execFileSync("git", ["commit", "-m", "config-inline"], { cwd: lab })
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("92-diagnostics.md") && f.includes("not updated"))).toBe(
      true,
    )
  })
})

describe("lint-docs-fresh on slice worktree", () => {
  it("passes explicit slice range", () => {
    if (!existsSync(path.join(REPO, "docs-for-llm"))) return
    const r = runCli(REPO, ["--range", "40aca861..HEAD"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("docs-freshness")
    expect(r.stderr).toBe("")
  })

  it("wide range skips four known-undocumented surfaces with notice", () => {
    if (!existsSync(path.join(REPO, "docs-for-llm"))) return
    const { fails, undocumentedSkipped } = runFreshnessChecks(REPO, "092439d8..HEAD")
    expect(fails).toHaveLength(0)
    expect(undocumentedSkipped).toBe(4)
    const r = runCli(REPO, ["--range", "092439d8..HEAD"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("4 known-undocumented surface(s) skipped")
    expect(r.stderr).toBe("")
  })
})

describe("KNOWN_UNDOCUMENTED is not a silence switch", () => {
  beforeEach(() => {
    seedDocsTree(lab)
    mkdirSync(path.join(lab, "packages/backend/src/delivery"), { recursive: true })
    mkdirSync(path.join(lab, "packages/core/src/schemas"), { recursive: true })
    mkdirSync(path.join(lab, "packages/core/src/config"), { recursive: true })
    writeFileSync(
      path.join(lab, "packages/core/src/schemas/mcp-docs.ts"),
      `export type McpToolName = "session_list"\n`,
      "utf8",
    )
    writeFileSync(
      path.join(lab, "packages/core/src/config/specs.ts"),
      "export const CONFIG_SPECS = []\n",
      "utf8",
    )
    writeFileSync(
      path.join(lab, "packages/backend/src/delivery/routes-lab.ts"),
      `import { Hono } from "hono"
const app = new Hono()
app.get("/api/zzz", (c) => c.text("z"))
export { app }
`,
      "utf8",
    )
    writeFileSync(
      path.join(lab, "docs/agents/openapi.json"),
      JSON.stringify(
        {
          openapi: "3.1.1",
          info: { version: "1.0.0" },
          paths: { "/api/zzz": { get: {} }, "/api/new-route": { get: {} } },
        },
        null,
        2,
      ),
      "utf8",
    )
    gitInitCommit(lab, "base")
  })

  it("14 — new route outside KNOWN_UNDOCUMENTED fails with owner message", () => {
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
    const { fails } = runFreshnessChecks(lab, lastRange(lab))
    expect(fails.some((f) => f.includes("no document declares GET /api/new-route"))).toBe(true)
    expect(fails.some((f) => f.includes("missing operation"))).toBe(false)
  })
})
