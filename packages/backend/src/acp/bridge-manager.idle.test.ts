/**
 * bridge-manager.idle.test.ts
 *
 * TEMPORARY (slice 26) — idle-reaper tracking tests.
 * Delete this file together with the TEMPORARY block in bridge-manager.ts
 * when background-agent management (future "slice A") lands.
 * See docs/plans/slice-26-bridge-idle-reaper.md §7.
 *
 * Implementation note: cross-platform spawnBridge helper — uses process.execPath
 * (node/bun) as the binary and a temporary JS script that calls setInterval to
 * stay alive. Compatible with Windows + Linux (no /usr/bin/sleep dependency).
 * afterEach is async and waits for child exit before cleanup to avoid EPERM on Windows.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createBridgeManager } from "./bridge-manager.js"

// Long-lived child processes spawned during tests — killed in afterEach
let spawnedChildren: ChildProcessWithoutNullStreams[] = []
let acpScriptPath: string | null = null

/**
 * Cross-platform spawnBridge helper.
 * Uses process.execPath (node/bun) as OPENCODE_BIN.
 * The "acp" script (placed in os.tmpdir()) keeps the process alive via setInterval.
 */
async function spawnBridge(bm: ReturnType<typeof createBridgeManager>, id: string): Promise<void> {
  // Create a long-lived JS script in tmpdir named "acp" (matches opencode args: ["acp"])
  if (!acpScriptPath) {
    const tmpDir = os.tmpdir()
    acpScriptPath = path.join(tmpDir, "acp")
    fs.writeFileSync(acpScriptPath, "setInterval(() => {}, 99999)\n", "utf8")
  }

  const original = process.env.OPENCODE_BIN
  process.env.OPENCODE_BIN = process.execPath  // node or bun binary
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

describe("bridge-manager listIdle (TEMPORARY slice 26)", () => {
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
    // Wait for all children to exit (avoids EPERM on Windows when cleanup runs)
    await Promise.all(waiting)
    spawnedChildren = []
  })

  // Test 1: active WS (hasActiveWs=true) — never in idle list
  it("1: bridge with active WS is never returned by listIdle", async () => {
    await spawnBridge(bm, "agent-1")
    bm.markAttached("agent-1")

    const now = Date.now()
    const timeout = 1000 // 1s

    // Even if enough time has passed
    const result = bm.listIdle(timeout, now + timeout * 3)
    expect(result).not.toContain("agent-1")
  })

  // Test 2: detached but not yet timed out
  it("2: detached bridge not returned before timeout", async () => {
    await spawnBridge(bm, "agent-2")
    bm.markAttached("agent-2")
    bm.markDetached("agent-2")

    const detachedAt = Date.now()
    const timeout = 10_000

    // now - lastDetachedAt < timeout
    const result = bm.listIdle(timeout, detachedAt + timeout - 1)
    expect(result).not.toContain("agent-2")
  })

  // Test 3: detached and timed out
  it("3: detached bridge returned after timeout", async () => {
    await spawnBridge(bm, "agent-3")
    bm.markAttached("agent-3")
    bm.markDetached("agent-3")

    const detachedAt = Date.now()
    const timeout = 10_000

    // now - lastDetachedAt >= timeout
    const result = bm.listIdle(timeout, detachedAt + timeout)
    expect(result).toContain("agent-3")
  })

  // Test 4: never had WS, within grace period (< timeout*2)
  it("4: never-attached bridge not returned within grace period", async () => {
    await spawnBridge(bm, "agent-4")

    const createdAt = bm.getCreatedAt("agent-4")!
    const timeout = 10_000

    // now - createdAt < timeout * 2
    const result = bm.listIdle(timeout, createdAt + timeout * 2 - 1)
    expect(result).not.toContain("agent-4")
  })

  // Test 5: never had WS, grace period expired (>= timeout*2)
  it("5: never-attached bridge returned after grace period expires", async () => {
    await spawnBridge(bm, "agent-5")

    const createdAt = bm.getCreatedAt("agent-5")!
    const timeout = 10_000

    // now - createdAt >= timeout * 2
    const result = bm.listIdle(timeout, createdAt + timeout * 2)
    expect(result).toContain("agent-5")
  })

  // Test 6: markAttached after detach removes from idle list (reconnect resets)
  it("6: markAttached after detach removes bridge from idle list", async () => {
    await spawnBridge(bm, "agent-6")
    bm.markAttached("agent-6")
    bm.markDetached("agent-6")

    const detachedAt = Date.now()
    const timeout = 10_000

    // Verify it would be idle
    const beforeReconnect = bm.listIdle(timeout, detachedAt + timeout)
    expect(beforeReconnect).toContain("agent-6")

    // Reconnect
    bm.markAttached("agent-6")

    // Now it should not be in the idle list
    const afterReconnect = bm.listIdle(timeout, detachedAt + timeout)
    expect(afterReconnect).not.toContain("agent-6")
  })
})
