import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

type MockChild = EventEmitter & {
  pid: number
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

// Mock node:child_process.spawn — נחזיר child mock עם stdout/stderr emitters
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn((_bin: string, _args: string[]) => {
      const child = new EventEmitter() as MockChild
      child.pid = 12345
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = vi.fn((_signal?: string) => {
        setTimeout(() => child.emit("exit", 0), 10)
      })

      // Simulate stdio-to-ws output: emit port after small delay
      setTimeout(() => {
        child.stdout.emit("data", Buffer.from("Listening on ws://127.0.0.1:7100/\n"))
      }, 20)

      return child
    }),
  }
})

describe("BridgeManager (integration with mock spawn)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function makeMgr() {
    // Re-import after vi.clearAllMocks to get fresh mock state.
    // We import createBridgeManager here to ensure mock is active.
    const { createBridgeManager } = await import("../src/acp/bridge-manager")
    return createBridgeManager()
  }

  it("spawns and returns handle with parsed port", async () => {
    const mgr = await makeMgr()
    const handle = await mgr.spawn("agent-1", {
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(handle.bridgeId).toBe("agent-1")
    expect(handle.port).toBe(7100)
    expect(handle.wsUrl).toBe("ws://127.0.0.1:7100/")
    expect(handle.cliKind).toBe("opencode")
  })

  it("get returns handle after spawn", async () => {
    const mgr = await makeMgr()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    expect(mgr.get("a-1")?.port).toBe(7100)
  })

  it("returns null for unknown bridgeId", async () => {
    const mgr = await makeMgr()
    expect(mgr.get("unknown")).toBeNull()
  })

  it("list returns all bridges", async () => {
    const mgr = await makeMgr()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    await mgr.spawn("a-2", { cliKind: "claude", cwd: "/foo", modelOverride: null })
    expect(mgr.list()).toHaveLength(2)
  })

  it("throws when spawning duplicate bridgeId", async () => {
    const mgr = await makeMgr()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    await expect(
      mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/already exists/)
  })

  it("kill removes bridge from registry", async () => {
    const mgr = await makeMgr()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    const killed = await mgr.kill("a-1")
    expect(killed).toBe(true)
    expect(mgr.get("a-1")).toBeNull()
  })

  it("kill returns false for unknown", async () => {
    const mgr = await makeMgr()
    expect(await mgr.kill("unknown")).toBe(false)
  })

  it("crash handler called on unexpected exit", async () => {
    const mgr = await makeMgr()
    const onCrash = vi.fn()
    mgr.onCrash(onCrash)

    await mgr.spawn("a-crash", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })

    // Get the mocked child and force it to exit unexpectedly
    const { spawn } = await import("node:child_process")
    const mockChild = vi.mocked(spawn).mock.results[0]?.value as MockChild
    mockChild.emit("exit", 1)

    await new Promise((r) => setTimeout(r, 20))
    expect(onCrash).toHaveBeenCalledWith("a-crash", 1)
  })
})
