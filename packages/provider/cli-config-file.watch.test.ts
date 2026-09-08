/**
 * cli-config-file.watch.test.ts — tests for the config-change watcher + cache invalidation
 * (slice cli-specs-hot-reload, Commit 0).
 *
 * The watcher lives on a directory (not the file) so vim-style save-by-rename is caught,
 * and it must call invalidateCache() — the single reset point — so the emit fires.
 *
 * Most tests here cover the deterministic parts (emit path, unsubscribe, cache reset,
 * the ENOENT guard) without real fs.watch timing, by pointing CLI_SPECS_FILE at a
 * missing directory so the lazy watcher never starts.
 *
 * The final describe block is the exception: it exercises a REAL fs.watch, because the
 * watcher now also has to notice config.jsonc — a file this module never reads — and a
 * deterministic test cannot show that the filename filter actually lets it through.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("invalidateCache / onConfigChange / stopWatching", () => {
  const origCliSpecsFile = process.env.CLI_SPECS_FILE
  const tmpFiles: string[] = []

  function writeTmpFile(content: string): string {
    const p = path.join(
      os.tmpdir(),
      `cli-watch-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonc`,
    )
    fs.writeFileSync(p, content, "utf8")
    tmpFiles.push(p)
    return p
  }

  beforeEach(() => {
    vi.resetModules()
    // Point at a missing directory so the lazy watcher never starts (no real fs.watch).
    process.env.CLI_SPECS_FILE = "/tmp/does-not-exist-cli-watch-dir/cli-specs.jsonc"
  })

  afterEach(() => {
    vi.resetModules()
    if (origCliSpecsFile === undefined) delete process.env.CLI_SPECS_FILE
    else process.env.CLI_SPECS_FILE = origCliSpecsFile
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f)
      } catch {
        /* ignore */
      }
    }
    tmpFiles.length = 0
  })

  it("invalidateCache emits to an onConfigChange listener", async () => {
    const { invalidateCache, onConfigChange } = await import("./src/config/cli-config-file.js")
    const cb = vi.fn()
    const unsub = onConfigChange(cb)
    invalidateCache()
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })

  it("unsubscribe stops further emits", async () => {
    const { invalidateCache, onConfigChange } = await import("./src/config/cli-config-file.js")
    const cb = vi.fn()
    const unsub = onConfigChange(cb)
    invalidateCache()
    unsub()
    invalidateCache()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("invalidateCache clears the memoized override (single reset point)", async () => {
    const filePath = writeTmpFile(JSON.stringify({ opencode: { bin: "/custom/opencode-1" } }))
    process.env.CLI_SPECS_FILE = filePath
    const { invalidateCache, loadCliSpecsOverride } = await import(
      "./src/config/cli-config-file.js"
    )
    expect(loadCliSpecsOverride().opencode?.bin).toBe("/custom/opencode-1")
    fs.writeFileSync(filePath, JSON.stringify({ opencode: { bin: "/custom/opencode-2" } }), "utf8")
    invalidateCache()
    expect(loadCliSpecsOverride().opencode?.bin).toBe("/custom/opencode-2")
  })

  it("onConfigChange on a missing directory does not throw (ENOENT guard)", async () => {
    const { onConfigChange, stopWatching } = await import("./src/config/cli-config-file.js")
    expect(() => onConfigChange(() => {})).not.toThrow()
    expect(() => stopWatching()).not.toThrow()
  })

  it("stopWatching is idempotent", async () => {
    const { stopWatching } = await import("./src/config/cli-config-file.js")
    expect(() => {
      stopWatching()
      stopWatching()
    }).not.toThrow()
  })
})

/**
 * Real fs.watch. Slower and inherently timing-dependent, so it is isolated here and
 * polls with a generous ceiling rather than a fixed sleep.
 */
describe("watcher — real fs.watch over the state directory", () => {
  const origCliSpecsFile = process.env.CLI_SPECS_FILE
  let dir = ""

  beforeEach(() => {
    vi.resetModules()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-watch-real-"))
    process.env.CLI_SPECS_FILE = path.join(dir, "cli-specs.jsonc")
  })

  afterEach(async () => {
    const mod = await import("./src/config/cli-config-file.js")
    mod.stopWatching()
    vi.resetModules()
    if (origCliSpecsFile === undefined) delete process.env.CLI_SPECS_FILE
    else process.env.CLI_SPECS_FILE = origCliSpecsFile
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** Waits for the debounced emit; fails the test by timing out rather than hanging. */
  async function waitForEmit(fired: () => boolean, budgetMs = 4000): Promise<boolean> {
    const deadline = Date.now() + budgetMs
    while (Date.now() < deadline) {
      if (fired()) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return false
  }

  it("fires on cli-specs.jsonc", async () => {
    const { onConfigChange } = await import("./src/config/cli-config-file.js")
    let count = 0
    const unsub = onConfigChange(() => {
      count += 1
    })

    fs.writeFileSync(path.join(dir, "cli-specs.jsonc"), '{"claude":{}}', "utf8")

    expect(await waitForEmit(() => count > 0)).toBe(true)
    unsub()
  })

  it("fires on config.jsonc too — a file this module never reads", async () => {
    const { onConfigChange } = await import("./src/config/cli-config-file.js")
    let count = 0
    const unsub = onConfigChange(() => {
      count += 1
    })

    fs.writeFileSync(path.join(dir, "config.jsonc"), '{"port":4100}', "utf8")

    expect(await waitForEmit(() => count > 0)).toBe(true)
    unsub()
  })

  it("ignores unrelated files in the same directory", async () => {
    const { onConfigChange } = await import("./src/config/cli-config-file.js")
    let count = 0
    const unsub = onConfigChange(() => {
      count += 1
    })

    // The state dir also holds cache/, recordings/, wire-recordings/, usage/.
    fs.writeFileSync(path.join(dir, "some-other-file.log"), "noise", "utf8")

    expect(await waitForEmit(() => count > 0, 600)).toBe(false)
    expect(count).toBe(0)
    unsub()
  })

  it("survives an atomic save (write-temp + rename), which is what editors do", async () => {
    const target = path.join(dir, "config.jsonc")
    fs.writeFileSync(target, '{"port":4100}', "utf8")

    const { onConfigChange } = await import("./src/config/cli-config-file.js")
    let count = 0
    const unsub = onConfigChange(() => {
      count += 1
    })

    // Replacing the inode would break a file-level watch; the directory-level
    // watch is what makes this work.
    const tmp = path.join(dir, ".config.jsonc.swp")
    fs.writeFileSync(tmp, '{"port":4200}', "utf8")
    fs.renameSync(tmp, target)

    expect(await waitForEmit(() => count > 0)).toBe(true)
    unsub()
  })
})
