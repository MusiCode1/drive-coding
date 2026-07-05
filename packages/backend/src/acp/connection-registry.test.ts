/**
 * connection-registry.test.ts — unit + regression tests (CUT-3b-ii Phase 0).
 *
 * Testing: tdd (brief §4 commit 0)
 *
 * Tests:
 *   - Map operations: connect/get/close
 *   - attached-state: markAttached/markDetached
 *   - getRuntimeInfo composition: pid + attached + busy + lastMessageAt
 *   - onCrash aggregate: crash fires cleanup + listeners
 *   - NBug1 dedup: connect twice on same agentId → first survives, second throws
 *   - Map-leak: close removes entry; crash removes entry
 *
 * Uses real child processes (node via OPENCODE_BIN override) for integration paths.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createConnectionRegistry } from "./connection-registry.js"

// ── helpers ───────────────────────────────────────────────────────────────────

let tmpScriptDir: string | null = null

function writeTmpScript(name: string, content: string): string {
  if (!tmpScriptDir) {
    tmpScriptDir = os.tmpdir()
  }
  const p = path.join(tmpScriptDir, `conn-reg-test-${name}.mjs`)
  fs.writeFileSync(p, content, "utf8")
  return p
}

const ALIVE_SCRIPT = writeTmpScript("alive", "setInterval(() => {}, 99999);\n")
const EXIT_SCRIPT = writeTmpScript("exit", "process.exit(0);\n")

function useScript(scriptPath: string): () => void {
  const prevBin = process.env.OPENCODE_BIN
  const prevArgs = process.env.OPENCODE_ARGS
  process.env.OPENCODE_BIN = process.execPath
  process.env.OPENCODE_ARGS = JSON.stringify([scriptPath])
  return () => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    if (prevArgs === undefined) delete process.env.OPENCODE_ARGS
    else process.env.OPENCODE_ARGS = prevArgs
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("connection-registry — basic Map operations", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("get returns undefined for unknown agentId", () => {
    const reg = createConnectionRegistry()
    expect(reg.get("unknown")).toBeUndefined()
  })

  it("getRuntimeInfo returns null for unknown agentId", () => {
    const reg = createConnectionRegistry()
    expect(reg.getRuntimeInfo("unknown")).toBeNull()
  })

  it("connect returns a ProviderConnection", async () => {
    const reg = createConnectionRegistry()
    const conn = await reg.connect("agent-1", "opencode", { cwd: os.tmpdir() })
    expect(conn).toBeDefined()
    expect(typeof conn.pid).toBe("number")
    await reg.close("agent-1")
  })

  it("get returns the connection after connect", async () => {
    const reg = createConnectionRegistry()
    const conn = await reg.connect("agent-2", "opencode", { cwd: os.tmpdir() })
    expect(reg.get("agent-2")).toBe(conn)
    await reg.close("agent-2")
  })

  it("get returns undefined after close", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("agent-3", "opencode", { cwd: os.tmpdir() })
    await reg.close("agent-3")
    expect(reg.get("agent-3")).toBeUndefined()
  })

  it("getRuntimeInfo returns null after close (no Map leak)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("agent-4", "opencode", { cwd: os.tmpdir() })
    await reg.close("agent-4")
    expect(reg.getRuntimeInfo("agent-4")).toBeNull()
  })

  it("close is idempotent (no throw on double-close)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("agent-5", "opencode", { cwd: os.tmpdir() })
    await reg.close("agent-5")
    await expect(reg.close("agent-5")).resolves.toBeUndefined()
  })

  // be-shutdown-hardening Commit 1: list() feeds graceful shutdown.
  it("list() returns empty array when no connections", () => {
    const reg = createConnectionRegistry()
    expect(reg.list()).toEqual([])
  })

  it("list() returns all live agentIds; shrinks after close", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("list-a", "opencode", { cwd: os.tmpdir() })
    await reg.connect("list-b", "opencode", { cwd: os.tmpdir() })
    expect(reg.list().sort()).toEqual(["list-a", "list-b"])
    await reg.close("list-a")
    expect(reg.list()).toEqual(["list-b"])
    await reg.close("list-b")
  })
})

describe("connection-registry — attached-state", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("getRuntimeInfo.attached = false after connect (default)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("att-1", "opencode", { cwd: os.tmpdir() })
    const info = reg.getRuntimeInfo("att-1")
    expect(info?.attached).toBe(false)
    await reg.close("att-1")
  })

  it("getRuntimeInfo.attached = true after markAttached", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("att-2", "opencode", { cwd: os.tmpdir() })
    reg.markAttached("att-2")
    const info = reg.getRuntimeInfo("att-2")
    expect(info?.attached).toBe(true)
    await reg.close("att-2")
  })

  it("getRuntimeInfo.attached = false after markDetached", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("att-3", "opencode", { cwd: os.tmpdir() })
    reg.markAttached("att-3")
    reg.markDetached("att-3")
    const info = reg.getRuntimeInfo("att-3")
    expect(info?.attached).toBe(false)
    await reg.close("att-3")
  })

  it("markAttached/markDetached no-op for unknown agentId (no throw)", () => {
    const reg = createConnectionRegistry()
    expect(() => reg.markAttached("unknown")).not.toThrow()
    expect(() => reg.markDetached("unknown")).not.toThrow()
  })
})

describe("connection-registry — getRuntimeInfo composition", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("getRuntimeInfo returns pid > 0 after connect", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("rt-1", "opencode", { cwd: os.tmpdir() })
    const info = reg.getRuntimeInfo("rt-1")
    expect(info).not.toBeNull()
    expect(typeof info!.pid).toBe("number")
    expect(info!.pid).toBeGreaterThan(0)
    await reg.close("rt-1")
  })

  it("getRuntimeInfo.busy = false before any sessionUpdate", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("rt-2", "opencode", { cwd: os.tmpdir() })
    const info = reg.getRuntimeInfo("rt-2")
    expect(info?.busy).toBe(false)
    await reg.close("rt-2")
  })
})

describe("connection-registry — onCrash aggregate (NBug Map-leak)", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(EXIT_SCRIPT)
  })

  afterEach(() => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("onCrash fires and entry is removed from Map after crash", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("crash-1", "opencode", { cwd: os.tmpdir() })

    const crashFired = await new Promise<boolean>((resolve) => {
      reg.onCrash((agentId) => {
        if (agentId === "crash-1") resolve(true)
      })
      // Give it time
      setTimeout(() => resolve(false), 3000)
    })

    expect(crashFired).toBe(true)
    // Entry must be cleaned up after crash (no Map leak)
    await new Promise((r) => setTimeout(r, 50))
    expect(reg.get("crash-1")).toBeUndefined()
    expect(reg.getRuntimeInfo("crash-1")).toBeNull()
  })

  it("onCrash unsubscribe works", async () => {
    const reg = createConnectionRegistry()
    const cb = vi.fn()
    const unsub = reg.onCrash(cb)
    unsub()

    await reg.connect("crash-2", "opencode", { cwd: os.tmpdir() })
    // Wait for child to exit
    await new Promise((r) => setTimeout(r, 500))
    expect(cb).not.toHaveBeenCalled()
  })
})

describe("connection-registry — NBug1 dedup (🔴 avigail)", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("double-connect on same agentId: second throws, first survives", async () => {
    const reg = createConnectionRegistry()
    const conn1 = await reg.connect("dedup-1", "opencode", { cwd: os.tmpdir() })
    reg.markAttached("dedup-1")

    // Second connect must throw (dedup guard fires BEFORE connectSpawn)
    await expect(reg.connect("dedup-1", "opencode", { cwd: os.tmpdir() })).rejects.toThrow(
      "already live",
    )

    // First connection must survive intact
    expect(reg.get("dedup-1")).toBe(conn1)
    const info = reg.getRuntimeInfo("dedup-1")
    expect(info).not.toBeNull()
    expect(info!.attached).toBe(true)

    await reg.close("dedup-1")
  })
})
