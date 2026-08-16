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

  it("getCwd returns undefined for unknown agentId", () => {
    const reg = createConnectionRegistry()
    expect(reg.getCwd("unknown")).toBeUndefined()
  })

  it("getCwd returns the cwd passed to connect", async () => {
    const reg = createConnectionRegistry()
    const cwd = os.tmpdir()
    await reg.connect("agent-cwd", "opencode", { cwd })
    expect(reg.getCwd("agent-cwd")).toBe(cwd)
    await reg.close("agent-cwd")
  })

  it("getCwd returns undefined after close (no Map leak)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("agent-cwd-2", "opencode", { cwd: os.tmpdir() })
    await reg.close("agent-cwd-2")
    expect(reg.getCwd("agent-cwd-2")).toBeUndefined()
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

describe("connection-registry — ownership epoch (slice ownership-truth C1)", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("epoch starts at 0 and is 0 for unknown agentId", async () => {
    const reg = createConnectionRegistry()
    expect(reg.getEpoch("unknown")).toBe(0)
    await reg.connect("ep-1", "opencode", { cwd: os.tmpdir() })
    expect(reg.getEpoch("ep-1")).toBe(0)
    await reg.close("ep-1")
  })

  it("epoch rises by 1 on null→owner (markOwned)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-2", "opencode", { cwd: os.tmpdir() })
    reg.markOwned("ep-2", "http")
    expect(reg.getEpoch("ep-2")).toBe(1)
    await reg.close("ep-2")
  })

  it("epoch rises on owner→owner transition (not just null→owner)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-3", "opencode", { cwd: os.tmpdir() })
    reg.markOwned("ep-3", "ws")
    expect(reg.getEpoch("ep-3")).toBe(1)
    reg.markOwned("ep-3", "http")
    expect(reg.getEpoch("ep-3")).toBe(2)
    await reg.close("ep-3")
  })

  it("🔴 epoch does NOT decrease on markDetached — survives release", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-4", "opencode", { cwd: os.tmpdir() })
    reg.markOwned("ep-4", "ws")
    expect(reg.getEpoch("ep-4")).toBe(1)
    reg.markDetached("ep-4")
    expect(reg.getEpoch("ep-4")).toBe(1) // still 1 — not reset
    await reg.close("ep-4")
  })

  it("epoch continues to rise after detach+re-own", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-5", "opencode", { cwd: os.tmpdir() })
    reg.markOwned("ep-5", "ws")
    reg.markDetached("ep-5")
    reg.markOwned("ep-5", "http")
    expect(reg.getEpoch("ep-5")).toBe(2) // 1 (first own) + 1 (re-own after detach)
    await reg.close("ep-5")
  })

  it("getOwner returns null initially, then the owner after markOwned", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-6", "opencode", { cwd: os.tmpdir() })
    expect(reg.getOwner("ep-6")).toBeNull()
    reg.markOwned("ep-6", "http")
    const owner = reg.getOwner("ep-6")
    expect(owner).not.toBeNull()
    expect(owner!.via).toBe("http")
    expect(typeof owner!.since).toBe("number")
    await reg.close("ep-6")
  })

  it("getOwner returns null after markDetached", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-7", "opencode", { cwd: os.tmpdir() })
    reg.markOwned("ep-7", "ws")
    reg.markDetached("ep-7")
    expect(reg.getOwner("ep-7")).toBeNull()
    await reg.close("ep-7")
  })

  it("isOwnedByWs: true only when owner.via === 'ws'", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-8", "opencode", { cwd: os.tmpdir() })
    expect(reg.isOwnedByWs("ep-8")).toBe(false)
    reg.markOwned("ep-8", "http")
    expect(reg.isOwnedByWs("ep-8")).toBe(false)
    reg.markOwned("ep-8", "ws")
    expect(reg.isOwnedByWs("ep-8")).toBe(true)
    reg.markDetached("ep-8")
    expect(reg.isOwnedByWs("ep-8")).toBe(false)
    await reg.close("ep-8")
  })

  it("markAttached is alias for markOwned(id, 'ws') — sets owner via 'ws'", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-9", "opencode", { cwd: os.tmpdir() })
    reg.markAttached("ep-9")
    const owner = reg.getOwner("ep-9")
    expect(owner).not.toBeNull()
    expect(owner!.via).toBe("ws")
    expect(reg.isOwnedByWs("ep-9")).toBe(true)
    expect(reg.getEpoch("ep-9")).toBe(1)
    await reg.close("ep-9")
  })

  it("attached === (owner !== null) invariant holds across transitions", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("ep-10", "opencode", { cwd: os.tmpdir() })
    // Initially: attached=false, owner=null
    expect(reg.isAttached("ep-10")).toBe(false)
    expect(reg.getOwner("ep-10")).toBeNull()
    // After markOwned: attached=true, owner≠null
    reg.markOwned("ep-10", "http")
    expect(reg.isAttached("ep-10")).toBe(true)
    expect(reg.getOwner("ep-10")).not.toBeNull()
    // After markDetached: attached=false, owner=null
    reg.markDetached("ep-10")
    expect(reg.isAttached("ep-10")).toBe(false)
    expect(reg.getOwner("ep-10")).toBeNull()
    await reg.close("ep-10")
  })
})

describe("connection-registry — liveness stamp (slice liveness C1)", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("touchOwner is transport-agnostic: updates lastSeenAt for WS and HTTP", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("live-1", "opencode", { cwd: os.tmpdir() })

    // no owner yet → null
    expect(reg.getLastSeenAt("live-1")).toBeNull()

    // WS owner (markAttached) → stamp exists; touchOwner keeps it fresh
    reg.markAttached("live-1")
    expect(reg.getLastSeenAt("live-1")).not.toBeNull()
    reg.touchOwner("live-1")
    expect(reg.getLastSeenAt("live-1")).not.toBeNull()

    // HTTP owner (markOwned) → stamp exists; touchOwner keeps it fresh
    reg.markOwned("live-1", "http")
    expect(reg.getLastSeenAt("live-1")).not.toBeNull()
    reg.touchOwner("live-1")
    expect(reg.getLastSeenAt("live-1")).not.toBeNull()

    await reg.close("live-1")
  })

  it("getLastSeenAt is null after markDetached (no owner)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("live-2", "opencode", { cwd: os.tmpdir() })
    reg.markOwned("live-2", "http")
    expect(reg.getLastSeenAt("live-2")).not.toBeNull()
    reg.markDetached("live-2")
    expect(reg.getLastSeenAt("live-2")).toBeNull()
    await reg.close("live-2")
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
