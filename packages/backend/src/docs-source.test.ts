import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** Fixed npm bundle path from docs-source.ts (../docs-agents relative to src/). */
const NPM_FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../docs-agents")

const { isBinaryMock } = vi.hoisted(() => ({
  isBinaryMock: vi.fn(() => false),
}))
vi.mock("./binary.js", () => ({
  isBinary: isBinaryMock,
}))

vi.mock("./docs-content.gen.js", () => ({
  AGENT_DOCS: { "from-binary.md": "binary-body" },
}))

import {
  createBinaryDocsSource,
  createNpmDocsSource,
  resolveDocsSource,
} from "./docs-source.js"

describe("createNpmDocsSource", () => {
  it("reads every file in the directory, sorted by name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dc-npm-docs-"))
    try {
      await writeFile(path.join(dir, "b.md"), "bbb")
      await writeFile(path.join(dir, "a.md"), "aaa")
      const names = createNpmDocsSource(dir)().map((f) => f.name)
      expect(names).toEqual(["a.md", "b.md"])
      expect(createNpmDocsSource(dir)().find((f) => f.name === "a.md")?.text).toBe("aaa")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("createBinaryDocsSource", () => {
  it("returns embedded AGENT_DOCS entries sorted by name", () => {
    expect(createBinaryDocsSource()()).toEqual([{ name: "from-binary.md", text: "binary-body" }])
  })
})

/**
 * resolveDocsSource() has no injection for candidate paths (brief §2 — by design).
 * Priority is asserted here via isBinary() mock + fixture at NPM_DOCS_CANDIDATES[0].
 */
describe("resolveDocsSource precedence", () => {
  beforeEach(async () => {
    isBinaryMock.mockReturnValue(false)
    await mkdir(NPM_FIXTURE_DIR, { recursive: true })
    await writeFile(path.join(NPM_FIXTURE_DIR, "index.json"), "{}")
    await writeFile(path.join(NPM_FIXTURE_DIR, "npm-only.md"), "npm-body")
  })

  afterEach(async () => {
    await rm(NPM_FIXTURE_DIR, { recursive: true, force: true })
  })

  it("binary wins over npm when isBinary() is true", () => {
    isBinaryMock.mockReturnValue(true)
    const names = resolveDocsSource()().map((f) => f.name)
    expect(names).toEqual(["from-binary.md"])
    expect(names).not.toContain("npm-only.md")
  })

  it("npm wins over dev when not binary and bundle dir exists", () => {
    const names = resolveDocsSource()().map((f) => f.name)
    expect(names).toContain("npm-only.md")
    expect(names).not.toContain("from-binary.md")
  })

  it("falls back to dev disk when not binary and no npm bundle", async () => {
    await rm(NPM_FIXTURE_DIR, { recursive: true, force: true })
    const names = resolveDocsSource()().map((f) => f.name)
    expect(names.some((n) => n.endsWith(".md"))).toBe(true)
    expect(names.length).toBeGreaterThan(5)
  })
})
