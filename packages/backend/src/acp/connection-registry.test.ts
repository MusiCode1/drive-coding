/**
 * connection-registry.test.ts — connection set (slice connection-set C0).
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { httpCacheGet, httpCacheInvalidateAll, httpCacheSet } from "../delivery/http-cache.js"
import { createConnectionRegistry } from "./connection-registry.js"

let tmpScriptDir: string | null = null

function writeTmpScript(name: string, content: string): string {
  if (!tmpScriptDir) tmpScriptDir = os.tmpdir()
  const p = path.join(tmpScriptDir, `conn-reg-test-${name}.mjs`)
  fs.writeFileSync(p, content, "utf8")
  return p
}

const ALIVE_SCRIPT = writeTmpScript("alive", "setInterval(() => {}, 99999);\n")

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

describe("connection-registry — connection set", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("attached=false until first addConnection", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a1", "opencode", { cwd: os.tmpdir() })
    expect(reg.getRuntimeInfo("a1")?.attached).toBe(false)
    await reg.close("a1")
  })

  it("two http rows ⇒ connectionCount=2 and attached=true", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a2", "opencode", { cwd: os.tmpdir() })
    reg.addConnection("a2", "c1", "http")
    reg.addConnection("a2", "c2", "http")
    expect(reg.getConnectionCount("a2")).toBe(2)
    expect(reg.isAttached("a2")).toBe(true)
    expect(reg.getRuntimeInfo("a2")?.via).toBe("http")
    await reg.close("a2")
  })

  it("removeConnection clears row; attached false when last row gone", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a3", "opencode", { cwd: os.tmpdir() })
    reg.addConnection("a3", "c1", "http")
    reg.removeConnection("a3", "c1")
    expect(reg.getConnectionCount("a3")).toBe(0)
    expect(reg.isAttached("a3")).toBe(false)
    await reg.close("a3")
  })

  it("onlyIfStream: stale SSE finally does not remove replaced row", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a4", "opencode", { cwd: os.tmpdir() })
    const stream1 = new ReadableStream()
    const stream2 = new ReadableStream()
    reg.addConnection("a4", "same", "http", stream1)
    reg.addConnection("a4", "same", "http", stream2)
    reg.removeConnection("a4", "same", { onlyIfStream: stream1 })
    expect(reg.getConnectionCount("a4")).toBe(1)
    reg.removeConnection("a4", "same", { onlyIfStream: stream2 })
    expect(reg.getConnectionCount("a4")).toBe(0)
    await reg.close("a4")
  })

  it("epoch rises on first http row, not on second http row", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a5", "opencode", { cwd: os.tmpdir() })
    expect(reg.getEpoch("a5")).toBe(0)
    reg.addConnection("a5", "h1", "http")
    expect(reg.getEpoch("a5")).toBe(1)
    reg.addConnection("a5", "h2", "http")
    expect(reg.getEpoch("a5")).toBe(1)
    await reg.close("a5")
  })

  it("epoch rises on ws addConnection", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a6", "opencode", { cwd: os.tmpdir() })
    reg.addConnection("a6", "w1", "ws")
    expect(reg.getEpoch("a6")).toBe(1)
    await reg.close("a6")
  })

  it("via prefers ws when both ws and http rows exist", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a7", "opencode", { cwd: os.tmpdir() })
    reg.addConnection("a7", "h1", "http")
    reg.addConnection("a7", "w1", "ws")
    expect(reg.getRuntimeInfo("a7")?.via).toBe("ws")
    await reg.close("a7")
  })

  it("isOwnedByWs uses injected checker, not the set", async () => {
    const reg = createConnectionRegistry({ isWsSocketActive: () => false })
    await reg.connect("a8", "opencode", { cwd: os.tmpdir() })
    reg.addConnection("a8", "w1", "ws")
    expect(reg.isOwnedByWs("a8")).toBe(false)
    reg.setWsSocketChecker(() => true)
    expect(reg.isOwnedByWs("a8")).toBe(true)
    await reg.close("a8")
  })

  it("touchConnection no-op when row missing", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("a9", "opencode", { cwd: os.tmpdir() })
    reg.addConnection("a9", "c1", "http")
    const before = reg.getLastSeenAt("a9")
    await new Promise((r) => setTimeout(r, 5))
    reg.touchConnection("a9", "missing")
    expect(reg.getLastSeenAt("a9")).toBe(before)
    reg.touchConnection("a9", "c1")
    expect(reg.getLastSeenAt("a9")).toBeGreaterThan(before as number)
    await reg.close("a9")
  })

  it("add/remove invalidate HTTP cache", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("c1", "opencode", { cwd: os.tmpdir() })
    httpCacheSet("agents", { agents: [] })
    reg.addConnection("c1", "x", "http")
    expect(httpCacheGet("agents")).toBeUndefined()
    httpCacheSet("agents", { agents: [] })
    reg.removeConnection("c1", "x")
    expect(httpCacheGet("agents")).toBeUndefined()
    httpCacheInvalidateAll()
    await reg.close("c1")
  })
})

describe("connection-registry — basic Map operations", () => {
  let cleanupEnv: (() => void) | null = null

  beforeEach(() => {
    cleanupEnv = useScript(ALIVE_SCRIPT)
  })

  afterEach(async () => {
    cleanupEnv?.()
    cleanupEnv = null
  })

  it("connect/get/close lifecycle", async () => {
    const reg = createConnectionRegistry()
    const conn = await reg.connect("agent-1", "opencode", { cwd: os.tmpdir() })
    expect(reg.get("agent-1")).toBe(conn)
    await reg.close("agent-1")
    expect(reg.get("agent-1")).toBeUndefined()
  })

  it("double-connect throws (NBug1)", async () => {
    const reg = createConnectionRegistry()
    await reg.connect("dedup-1", "opencode", { cwd: os.tmpdir() })
    await expect(reg.connect("dedup-1", "opencode", { cwd: os.tmpdir() })).rejects.toThrow(
      "already live",
    )
    await reg.close("dedup-1")
  })
})
