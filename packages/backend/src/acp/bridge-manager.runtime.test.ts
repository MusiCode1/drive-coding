/**
 * bridge-manager.runtime.test.ts
 *
 * Tests for getRuntimeInfo — slice active-agents-backend (commit 1).
 * Cross-platform: uses process.execPath + tmpdir acp script (no /usr/bin/sleep).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createBridgeManager } from "./bridge-manager.js"

let spawnedChildren: ChildProcessWithoutNullStreams[] = []
let acpScriptPath: string | null = null

async function spawnBridge(bm: ReturnType<typeof createBridgeManager>, id: string): Promise<void> {
  if (!acpScriptPath) {
    const tmpDir = os.tmpdir()
    acpScriptPath = path.join(tmpDir, "acp")
    fs.writeFileSync(acpScriptPath, "setInterval(() => {}, 99999)\n", "utf8")
  }

  const original = process.env.OPENCODE_BIN
  process.env.OPENCODE_BIN = process.execPath
  try {
    await bm.spawnWithStderr(id, {
      cliKind: "opencode",
      cwd: os.tmpdir(),
      modelOverride: null,
    })
  } finally {
    if (original === undefined) {
      delete process.env.OPENCODE_BIN
    } else {
      process.env.OPENCODE_BIN = original
    }
  }
  const child = bm.getChild(id)
  if (child) spawnedChildren.push(child)
}

describe("bridge-manager getRuntimeInfo (slice active-agents)", () => {
  let bm: ReturnType<typeof createBridgeManager>

  beforeEach(() => {
    bm = createBridgeManager()
    spawnedChildren = []
  })

  afterEach(async () => {
    const waiting: Promise<void>[] = []
    for (const p of spawnedChildren) {
      if (!p.killed && p.exitCode === null) {
        const exitPromise = new Promise<void>((resolve) => {
          p.once("exit", () => resolve())
          p.once("error", () => resolve())
        })
        try {
          p.kill("SIGKILL")
        } catch {
          // already dead
        }
        waiting.push(exitPromise)
      }
    }
    await Promise.all(waiting)
    spawnedChildren = []
  })

  it("getRuntimeInfo returns null for unknown bridge", () => {
    const result = bm.getRuntimeInfo("unknown-id")
    expect(result).toBeNull()
  })

  it("getRuntimeInfo returns { pid, attached: false } after spawnBridge", async () => {
    await spawnBridge(bm, "rt-agent-1")
    const info = bm.getRuntimeInfo("rt-agent-1")
    expect(info).not.toBeNull()
    expect(typeof info!.pid).toBe("number")
    expect(info!.pid).toBeGreaterThan(0)
    expect(info!.attached).toBe(false)
  })

  it("getRuntimeInfo returns attached: true after markAttached", async () => {
    await spawnBridge(bm, "rt-agent-2")
    bm.markAttached("rt-agent-2")
    const info = bm.getRuntimeInfo("rt-agent-2")
    expect(info!.attached).toBe(true)
  })

  it("getRuntimeInfo returns attached: false after markDetached", async () => {
    await spawnBridge(bm, "rt-agent-3")
    bm.markAttached("rt-agent-3")
    bm.markDetached("rt-agent-3")
    const info = bm.getRuntimeInfo("rt-agent-3")
    expect(info!.attached).toBe(false)
  })
})
