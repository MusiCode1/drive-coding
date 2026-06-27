/**
 * bridge-manager.runtime.test.ts
 *
 * Tests for getRuntimeInfo — slice active-agents-backend (commit 1).
 * Cross-platform: uses process.execPath + tmpdir acp script (no /usr/bin/sleep).
 *
 * R3 addition: regression test — busy+record via spawnWithStderr (production path).
 * The existing tests only verify pid/attached; they stay green even if initBridge
 * is never called via spawnWithStderr. The new test catches 🔴#1 in CI.
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

/**
 * Spawn via spawnWithStderr using a child that emits a real session/update frame to stdout,
 * then stays alive. Returns child + bridge id.
 *
 * Used by the R3 regression test to verify busy=true arrives via the production path.
 */
async function spawnBridgeWithFrame(
  bm: ReturnType<typeof createBridgeManager>,
  id: string,
): Promise<ChildProcessWithoutNullStreams> {
  // Real session/update frame that turn-tracker recognises as sessionUpdate.
  const frame = JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "hi" } } },
  })
  const scriptPath = path.join(os.tmpdir(), `bm-frame-${id}.mjs`)
  // Write frame to stdout, then stay alive so the bridge is still registered when we poll.
  fs.writeFileSync(
    scriptPath,
    `process.stdout.write(${JSON.stringify(`${frame}\n`)});\nsetInterval(() => {}, 99999);\n`,
    "utf8",
  )

  const prevBin = process.env.OPENCODE_BIN
  const prevArgs = process.env.OPENCODE_ARGS
  process.env.OPENCODE_BIN = process.execPath
  process.env.OPENCODE_ARGS = JSON.stringify([scriptPath])
  try {
    await bm.spawnWithStderr(id, {
      cliKind: "opencode",
      cwd: os.tmpdir(),
      modelOverride: null,
    })
  } finally {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    if (prevArgs === undefined) delete process.env.OPENCODE_ARGS
    else process.env.OPENCODE_ARGS = prevArgs
  }

  const child = bm.getChild(id)
  if (!child) throw new Error(`spawnBridgeWithFrame: no child for ${id}`)
  spawnedChildren.push(child)
  return child
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
    expect(typeof info?.pid).toBe("number")
    expect(info?.pid).toBeGreaterThan(0)
    expect(info?.attached).toBe(false)
  })

  it("getRuntimeInfo returns attached: true after markAttached", async () => {
    await spawnBridge(bm, "rt-agent-2")
    bm.markAttached("rt-agent-2")
    const info = bm.getRuntimeInfo("rt-agent-2")
    expect(info?.attached).toBe(true)
  })

  it("getRuntimeInfo returns attached: false after markDetached", async () => {
    await spawnBridge(bm, "rt-agent-3")
    bm.markAttached("rt-agent-3")
    bm.markDetached("rt-agent-3")
    const info = bm.getRuntimeInfo("rt-agent-3")
    expect(info?.attached).toBe(false)
  })

  // ─── R3 regression: busy via spawnWithStderr (production path) ───────────────
  // This test catches 🔴#1: if initBridge is never called via spawnWithStderr,
  // turn-tracker is never set → busy always false even during a live turn.
  // The existing tests above stay green regardless — they only check pid/attached.
  //
  // Mechanism: spawn a child that emits a real session/update frame → poll
  // getRuntimeInfo().busy within the debounce window (~1500ms).
  // Uses actual Date.now() (not mock-clock) + short poll interval.
  it("getRuntimeInfo.busy=true via spawnWithStderr after real session/update frame", async () => {
    await spawnBridgeWithFrame(bm, "rt-busy-1")

    // Poll for busy=true within the turn-tracker debounce window (default 1500ms).
    // The frame is emitted immediately by the script; readline fires within ~100ms.
    const deadline = Date.now() + 1500
    let busy = false
    while (Date.now() < deadline) {
      const info = bm.getRuntimeInfo("rt-busy-1")
      if (info?.busy) {
        busy = true
        break
      }
      await new Promise((r) => setTimeout(r, 30))
    }

    expect(busy).toBe(true)
  }, 3000 /* generous timeout: debounce=1500ms + poll overhead */)
})
