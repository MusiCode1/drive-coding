/**
 * bridge-manager.idle.test.ts
 *
 * TEMPORARY (slice 26) — idle-reaper tracking tests.
 * Delete this file together with the TEMPORARY block in bridge-manager.ts
 * when background-agent management (future "slice A") lands.
 * See docs/plans/slice-26-bridge-idle-reaper.md §7.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import { createBridgeManager } from "./bridge-manager.js"

// Helper: spawn a long-running no-op process to satisfy bridge-manager's spawn requirement.
// "cat" with no args reads stdin forever and never exits on its own.
let catProcesses: ChildProcessWithoutNullStreams[] = []

function spawnCat(): void {
  // We don't need to track individually — afterEach kills all
}

describe("bridge-manager listIdle (TEMPORARY slice 26)", () => {
  let bm: ReturnType<typeof createBridgeManager>

  beforeEach(() => {
    bm = createBridgeManager()
    catProcesses = []
  })

  afterEach(() => {
    // Kill all spawned cat processes
    for (const p of catProcesses) {
      try {
        p.kill("SIGKILL")
      } catch {
        // already dead
      }
    }
    catProcesses = []
  })

  // Spawn a bridge using a harmless cat process and track it
  async function spawnBridge(id: string): Promise<void> {
    const handle = await bm.spawnWithStderr(id, {
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })
    // Track the child so afterEach can clean up
    const child = bm.getChild(id)
    if (child) catProcesses.push(child)
  }

  // Test 1: active WS (hasActiveWs=true) — never in idle list
  it("1: bridge with active WS is never returned by listIdle", async () => {
    await spawnBridge("agent-1")
    bm.markAttached("agent-1")

    const now = Date.now()
    const timeout = 1000 // 1s

    // Even if enough time has passed
    const result = bm.listIdle(timeout, now + timeout * 3)
    expect(result).not.toContain("agent-1")
  })

  // Test 2: detached but not yet timed out
  it("2: detached bridge not returned before timeout", async () => {
    await spawnBridge("agent-2")
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
    await spawnBridge("agent-3")
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
    await spawnBridge("agent-4")

    const createdAt = Date.now()
    const timeout = 10_000

    // now - createdAt < timeout * 2
    const result = bm.listIdle(timeout, createdAt + timeout * 2 - 1)
    expect(result).not.toContain("agent-4")
  })

  // Test 5: never had WS, grace period expired (>= timeout*2)
  it("5: never-attached bridge returned after grace period expires", async () => {
    await spawnBridge("agent-5")

    const createdAt = Date.now()
    const timeout = 10_000

    // now - createdAt >= timeout * 2
    const result = bm.listIdle(timeout, createdAt + timeout * 2)
    expect(result).toContain("agent-5")
  })

  // Test 6: markAttached after detach removes from idle list (reconnect resets)
  it("6: markAttached after detach removes bridge from idle list", async () => {
    await spawnBridge("agent-6")
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
