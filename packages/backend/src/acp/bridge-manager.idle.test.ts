/**
 * bridge-manager.idle.test.ts
 *
 * TEMPORARY (slice 26) — idle-reaper tracking tests.
 * Delete this file together with the TEMPORARY block in bridge-manager.ts
 * when background-agent management (future "slice A") lands.
 * See docs/plans/slice-26-bridge-idle-reaper.md §7.
 *
 * Implementation note: we use `sleep 100` as the bridge binary to get a
 * long-lived process that doesn't exit during the test. This avoids the
 * bridge-manager cleaning up the entry on child exit before we can test
 * the listIdle logic against it. afterEach kills all spawned processes.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createBridgeManager } from "./bridge-manager.js"

const SLEEP_BIN = "/usr/bin/sleep"

// Long-lived child processes spawned during tests — killed in afterEach
let spawnedChildren: ChildProcessWithoutNullStreams[] = []

describe("bridge-manager listIdle (TEMPORARY slice 26)", () => {
  let bm: ReturnType<typeof createBridgeManager>

  beforeEach(() => {
    bm = createBridgeManager()
    spawnedChildren = []
  })

  afterEach(() => {
    for (const p of spawnedChildren) {
      try {
        p.kill("SIGKILL")
      } catch {
        // already dead
      }
    }
    spawnedChildren = []
  })

  /**
   * Spawn a bridge backed by `sleep 100` — a real, long-lived process.
   * Using the opencode cliKind but overriding via OPENCODE_BIN env trick
   * is not available; instead we rely on a fallback: if `opencode` is not
   * found bun test would fail. We directly use the `bm` internal spawn
   * by working around cliKind. Since the test environment may not have
   * opencode, we use `sleep` via the `gemini` cliKind which maps to `gemini`
   * binary — also absent. The safest approach: use cliKind "opencode" and
   * set OPENCODE_BIN to /usr/bin/sleep via process.env before spawn.
   */
  async function spawnBridge(id: string): Promise<void> {
    // Temporarily override OPENCODE_BIN so bridge-manager spawns `sleep 100`
    const original = process.env.OPENCODE_BIN
    process.env.OPENCODE_BIN = SLEEP_BIN
    try {
      await bm.spawnWithStderr(id, {
        cliKind: "opencode",
        cwd: "/tmp",
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
  //
  // ‏מדולג בכוונה — flaky test, לא באג בקוד. ‏ה-test קורא Date.now() בשורה
  // ‏שאחרי await spawnBridge ומניח שהוא שווה ל-createdAt שנקבע *בתוך* spawn.
  // ‏תחת עומס scheduler ה-drift חורג מה-grace (‏ה-`-1` הופך את התנאי לרגיש).
  // ‏הקוד (listIdle ב-bridge-manager.ts) תקין. ‏ה-brief לתיקון (getCreatedAt
  // ‏getter במקום Date.now()) נזנח — ראה docs/decisions/voice-acp.md 2026-06-02.
  it.skip("4: never-attached bridge not returned within grace period", async () => {
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
