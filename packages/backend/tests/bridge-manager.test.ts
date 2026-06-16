import { type ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"

type MockChild = EventEmitter & {
  pid: number | undefined
  stdout: PassThrough
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

// Mock node:child_process.spawn — each test configures behavior via mockSpawnFn
const mockSpawnFn = vi.fn()

vi.mock("node:child_process", () => {
  return {
    spawn: (...args: unknown[]) => mockSpawnFn(...args),
  }
})

function makeSuccessChild(pid = 12345): MockChild {
  const child = new EventEmitter() as MockChild
  child.pid = pid
  // PassThrough מממש resume()/pause() — נדרש ל-createInterface ב-bridge-manager
  child.stdout = new PassThrough()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn() }
  child.kill = vi.fn((_signal?: string) => {
    setTimeout(() => child.emit("exit", 0), 10)
  })
  return child
}

function makeNoPidChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.pid = undefined
  // PassThrough מממש resume()/pause() — נדרש ל-createInterface ב-bridge-manager
  child.stdout = new PassThrough()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn() }
  child.kill = vi.fn()
  return child
}

describe("BridgeManager (new in-process spawn)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function makeMgr() {
    const { createBridgeManager } = await import("../src/acp/bridge-manager")
    return createBridgeManager()
  }

  it("spawns and returns handle with pid (no port/wsUrl needed)", async () => {
    const child = makeSuccessChild(9999)
    mockSpawnFn.mockReturnValue(child)

    const mgr = await makeMgr()
    const handle = await mgr.spawn("agent-1", {
      cliKind: "opencode",
      cwd: "/tmp",
      modelOverride: null,
    })

    expect(handle.bridgeId).toBe("agent-1")
    expect(handle.pid).toBe(9999)
    expect(handle.cliKind).toBe("opencode")
    // In-process: port=0 and wsUrl="" are acceptable (backward compat)
    expect(handle.port).toBeDefined()
    expect(handle.wsUrl).toBeDefined()
  })

  it("get returns handle after spawn", async () => {
    const child = makeSuccessChild()
    mockSpawnFn.mockReturnValue(child)

    const mgr = await makeMgr()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    expect(mgr.get("a-1")).not.toBeNull()
    expect(mgr.get("a-1")?.bridgeId).toBe("a-1")
  })

  it("returns null for unknown bridgeId", async () => {
    const mgr = await makeMgr()
    expect(mgr.get("unknown")).toBeNull()
  })

  it("list returns all bridges", async () => {
    const child1 = makeSuccessChild(1)
    const child2 = makeSuccessChild(2)
    mockSpawnFn.mockReturnValueOnce(child1).mockReturnValueOnce(child2)

    const mgr = await makeMgr()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    await mgr.spawn("a-2", { cliKind: "claude", cwd: "/foo", modelOverride: null })
    expect(mgr.list()).toHaveLength(2)
  })

  it("throws when spawning duplicate bridgeId", async () => {
    const child = makeSuccessChild()
    mockSpawnFn.mockReturnValue(child)

    const mgr = await makeMgr()
    await mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })
    await expect(
      mgr.spawn("a-1", { cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/already exists/)
  })

  it("kill removes bridge from registry", async () => {
    const child = makeSuccessChild()
    mockSpawnFn.mockReturnValue(child)

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
    const child = makeSuccessChild()
    mockSpawnFn.mockReturnValue(child)

    const mgr = await makeMgr()
    const onCrash = vi.fn()
    mgr.onCrash(onCrash)

    await mgr.spawn("a-crash", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })

    // Force unexpected exit (not via kill)
    child.emit("exit", 1)

    await new Promise((r) => setTimeout(r, 20))
    expect(onCrash).toHaveBeenCalledWith("a-crash", { exitCode: 1, signal: null })
  })

  it("spawn with no-pid rejects and no uncaught error", async () => {
    const child = makeNoPidChild()
    mockSpawnFn.mockReturnValue(child)

    const uncaught: unknown[] = []
    const onErr = (e: unknown) => uncaught.push(e)
    const onRej = (r: unknown) => uncaught.push(r)
    process.on("uncaughtException", onErr)
    process.on("unhandledRejection", onRej)

    const mgr = await makeMgr()
    await expect(
      mgr.spawn("no-pid", { cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
    ).rejects.toThrow(/no pid/)

    // Give async error event time to surface
    await new Promise((r) => setTimeout(r, 50))
    process.off("uncaughtException", onErr)
    process.off("unhandledRejection", onRej)
    expect(uncaught).toHaveLength(0)
  })

  it("getChild returns the ChildProcess after spawn", async () => {
    const child = makeSuccessChild(7777)
    mockSpawnFn.mockReturnValue(child)

    const mgr = await makeMgr()
    await mgr.spawn("agent-child", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })

    const retrieved = mgr.getChild("agent-child")
    expect(retrieved).toBe(child)
    expect((retrieved as unknown as MockChild).pid).toBe(7777)
  })

  it("getChild returns null for unknown agentId", async () => {
    const mgr = await makeMgr()
    expect(mgr.getChild("missing")).toBeNull()
  })
})
