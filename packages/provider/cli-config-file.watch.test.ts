/**
 * cli-config-file.watch.test.ts — tests for the config-change watcher + cache invalidation
 * (slice cli-specs-hot-reload, Commit 0).
 *
 * The watcher lives on a directory (not the file) so vim-style save-by-rename is caught,
 * and it must call invalidateCache() — the single reset point — so the emit fires.
 *
 * These tests cover the deterministic parts (emit path, unsubscribe, cache reset, the
 * ENOENT guard) without real fs.watch timing. The actual fs.watch event loop is verified
 * manually (edit cli-specs.jsonc → cache clears) per the brief's Commit 0 verification.
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
