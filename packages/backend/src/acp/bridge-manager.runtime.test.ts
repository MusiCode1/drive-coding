/**
 * bridge-manager.runtime.test.ts
 *
 * Tests for getRuntimeInfo — slice active-agents-backend (commit 1).
 * Map-leak regression — CUT-2: wrapperState cleaned up after kill/crash.
 * Cross-platform: uses process.execPath + tmpdir acp script (no /usr/bin/sleep).
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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
    expect(info?.attached).toBe(false)
  })
})

describe("bridge-manager Map-leak regression (CUT-2)", () => {
  // Verifies that wrapperState entries are cleaned up after kill/crash — no leak.
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

  it("getRuntimeInfo returns null after bm.kill (wrapperState cleaned up)", async () => {
    await spawnBridge(bm, "leak-agent-1")
    // Kill via bm — should clean up both core store and wrapperState
    await bm.kill("leak-agent-1")
    // After kill, getRuntimeInfo must return null (not leak the entry)
    expect(bm.getRuntimeInfo("leak-agent-1")).toBeNull()
  })

  it("getRuntimeInfo returns null after child exits naturally (crash path)", async () => {
    await spawnBridge(bm, "leak-agent-2")
    const child = bm.getChild("leak-agent-2")
    if (!child) throw new Error("child not found")
    // Kill the child externally — simulates crash; onCrash fires in core → wrapper cleans up
    const exitPromise = new Promise<void>((resolve) => {
      child.once("exit", () => resolve())
    })
    child.kill("SIGKILL")
    await exitPromise
    // Give crash handlers a tick to run
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(bm.getRuntimeInfo("leak-agent-2")).toBeNull()
  })
})
