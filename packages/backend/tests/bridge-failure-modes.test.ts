/**
 * bridge-failure-modes.test.ts — F-1 regression tests.
 *
 * The exploratory tester reported (Slice 10 report, F-1):
 *   "BE process קורס בעקבות ENOENT על npx ב-spawnAndWaitForPort"
 *
 * Trigger cases observed:
 *   1. POST /api/agents with cwd that does not exist (`/nonexistent/path`).
 *   2. spawn returns ENOENT for the binary itself (PATH issue).
 *   3. Repeated spawn cycles eventually trip an async error.
 *
 * In all of these, the symptom was the same: the Bun process running the
 * backend exited with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, killing all
 * in-memory agents and forcing the FE to reload.
 *
 * This file locks in the desired behavior at every layer where the failure
 * can leak:
 *   - `createConnectionRegistry().connect` rejects cleanly on every failure mode
 *   - `createConnectionRegistry().connect` propagates the rejection without
 *     leaving stray listeners on the lost child
 *   - `createAgentOrchestrator().createAndSpawn` returns an error to the
 *     HTTP caller and marks the agent crashed
 *   - **no `uncaughtException` or `unhandledRejection` fires during any of
 *     the above** — this is the actual regression that crashes the BE.
 *
 * CUT-3b-ii: bridge-manager replaced by connection-registry.
 *
 * If a future refactor reintroduces a path where spawn errors escape to
 * `uncaughtException`, one of these tests will fail.
 */

import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ─── Mock spawn ────────────────────────────────────────────────────────
// We mock `node:child_process.spawn` and let each test configure the
// behavior via a module-level `spawnBehavior` setter.

type SpawnBehavior =
  | { kind: "throw-sync"; error: Error }
  | { kind: "no-pid" }
  | { kind: "async-error"; error: Error; delayMs?: number }
  | { kind: "exit-before-port"; code: number; stderr?: string; delayMs?: number }
  | { kind: "success"; port: number }

let spawnBehavior: SpawnBehavior = { kind: "success", port: 7100 }

type MockChild = EventEmitter & {
  pid: number | undefined
  stdout: PassThrough
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn((_bin: string, _args: string[]) => {
      switch (spawnBehavior.kind) {
        case "throw-sync": {
          throw spawnBehavior.error
        }
        case "no-pid": {
          const child = new EventEmitter() as MockChild
          child.pid = undefined
          // PassThrough נדרש ל-createInterface ב-bridge-manager (resume/pause)
          child.stdout = new PassThrough()
          child.stderr = new EventEmitter()
          child.stdin = { write: vi.fn() }
          child.kill = vi.fn()
          return child
        }
        case "async-error": {
          const child = new EventEmitter() as MockChild
          child.pid = 12345
          child.stdout = new PassThrough()
          child.stderr = new EventEmitter()
          child.stdin = { write: vi.fn() }
          child.kill = vi.fn()
          setTimeout(() => {
            child.emit(
              "error",
              spawnBehavior.kind === "async-error" ? spawnBehavior.error : new Error(),
            )
          }, spawnBehavior.delayMs ?? 5)
          return child
        }
        case "exit-before-port": {
          const child = new EventEmitter() as MockChild
          child.pid = 12345
          child.stdout = new PassThrough()
          child.stderr = new EventEmitter()
          child.stdin = { write: vi.fn() }
          child.kill = vi.fn()
          if (spawnBehavior.kind === "exit-before-port") {
            const behavior = spawnBehavior
            setTimeout(() => {
              if (behavior.stderr) {
                child.stderr.emit("data", Buffer.from(behavior.stderr))
              }
              child.emit("exit", behavior.code)
            }, behavior.delayMs ?? 5)
          }
          return child
        }
        case "success": {
          const child = new EventEmitter() as MockChild
          child.pid = 12345
          child.stdout = new PassThrough()
          child.stderr = new EventEmitter()
          child.stdin = { write: vi.fn() }
          child.kill = vi.fn((_sig?: string) => {
            setTimeout(() => child.emit("exit", 0), 5)
          })
          return child
        }
      }
    }),
  }
})

// ─── uncaught monitor ─────────────────────────────────────────────────
// Detects if anything escapes to the host process during a test.

function withUncaughtMonitor(): {
  start: () => void
  stopAndAssertClean: () => Promise<void>
} {
  const uncaught: unknown[] = []
  const onException = (err: unknown) => uncaught.push({ type: "uncaughtException", err })
  const onRejection = (reason: unknown) => uncaught.push({ type: "unhandledRejection", reason })

  return {
    start() {
      uncaught.length = 0
      process.on("uncaughtException", onException)
      process.on("unhandledRejection", onRejection)
    },
    async stopAndAssertClean() {
      // Give async errors a tick to surface
      await new Promise((r) => setTimeout(r, 50))
      process.off("uncaughtException", onException)
      process.off("unhandledRejection", onRejection)
      if (uncaught.length > 0) {
        throw new Error(
          `${uncaught.length} uncaught error(s) escaped during test:\n${JSON.stringify(uncaught, null, 2)}`,
        )
      }
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("F-1 regression: bridge spawn failures must not crash the BE", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spawnBehavior = { kind: "success", port: 7100 }
    // Silence noisy logs from production code during tests
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("at connection-registry layer (CUT-3b-ii)", () => {
    it("rejects cleanly when spawn throws synchronously (Bun ENOENT edge case)", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      const enoent = Object.assign(new Error("spawn ENOENT"), {
        code: "ENOENT",
        syscall: "spawn npx",
        path: "npx",
      })
      spawnBehavior = { kind: "throw-sync", error: enoent }

      const { createConnectionRegistry } = await import("../src/acp/connection-registry")
      const reg = createConnectionRegistry()

      await expect(reg.connect("agent-fail", "opencode", { cwd: "/tmp" })).rejects.toThrow(/ENOENT/)

      await monitor.stopAndAssertClean()
    })

    it("rejects cleanly when spawn returns child with no pid", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      spawnBehavior = { kind: "no-pid" }

      const { createConnectionRegistry } = await import("../src/acp/connection-registry")
      const reg = createConnectionRegistry()

      await expect(reg.connect("agent-nopid", "opencode", { cwd: "/tmp" })).rejects.toThrow(
        /no pid/,
      )

      await monitor.stopAndAssertClean()
    })

    it("rejects cleanly when child emits async error after spawn", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
      // async-error: pid exists but then error fires async.
      // connect() succeeds (pid=12345 returned), then crash fires async.
      // The registry registers the error handler before the error fires,
      // so it should handle it cleanly — no uncaught escape.
      spawnBehavior = { kind: "async-error", error: enoent, delayMs: 5 }

      const { createConnectionRegistry } = await import("../src/acp/connection-registry")
      const reg = createConnectionRegistry()

      const connectPromise = reg.connect("agent-async-err", "opencode", { cwd: "/tmp" })
      // connect should resolve (pid is set), then crash event fires
      await connectPromise.catch(() => {})

      // Give the async error time to fire
      await new Promise((r) => setTimeout(r, 50))

      await monitor.stopAndAssertClean()
    })

    it("handles child exit cleanly (notifies crash listener, no uncaught)", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      spawnBehavior = { kind: "success", port: 7100 }

      const { createConnectionRegistry } = await import("../src/acp/connection-registry")
      const reg = createConnectionRegistry()
      const crashSpy = vi.fn()
      reg.onCrash(crashSpy)

      await reg.connect("agent-exit", "opencode", { cwd: "/tmp" })

      // Simulate unexpected exit
      const { spawn } = await import("node:child_process")
      const child = vi.mocked(spawn).mock.results[0]?.value as MockChild
      child.emit("exit", 127)

      await new Promise((r) => setTimeout(r, 20))
      // Commit 1 (surface-crash-stderr): notifyCrash now also carries the captured
      // stderr lines (empty here — no stderr was emitted in this scenario).
      expect(crashSpy).toHaveBeenCalledWith("agent-exit", {
        exitCode: 127,
        signal: null,
        stderr: [],
      })
      // After crash, conn removed from registry
      expect(reg.get("agent-exit")).toBeUndefined()

      await monitor.stopAndAssertClean()
    })

    it("connectionRegistry.connect — propagates ENOENT cleanly, no leak", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
      spawnBehavior = { kind: "throw-sync", error: enoent }

      const { createConnectionRegistry } = await import("../src/acp/connection-registry")
      const reg = createConnectionRegistry()

      await expect(reg.connect("agent-fail", "opencode", { cwd: "/tmp" })).rejects.toThrow()

      await monitor.stopAndAssertClean()
    })

    it("connection-registry — child exit removes conn from map, no uncaught", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      // exit-before-port: pid=12345 exists, but child exits quickly.
      spawnBehavior = {
        kind: "exit-before-port",
        code: 127,
        stderr: "command not found\n",
        delayMs: 5,
      }

      const { createConnectionRegistry } = await import("../src/acp/connection-registry")
      const reg = createConnectionRegistry()
      const crashSpy = vi.fn()
      reg.onCrash(crashSpy)

      // connect should succeed (pid is set)
      const conn = await reg.connect("agent-x", "opencode", { cwd: "/tmp" })
      expect(conn.pid).toBe(12345)
      expect(reg.get("agent-x")).not.toBeUndefined()

      // Wait for exit to fire
      await new Promise((r) => setTimeout(r, 50))

      // Registry should not have this conn in its map after crash
      expect(reg.get("agent-x")).toBeUndefined()
      // crash handler was called
      // Commit 1 (surface-crash-stderr): notifyCrash now also carries the captured
      // stderr lines — here the "command not found\n" chunk emitted before exit.
      expect(crashSpy).toHaveBeenCalledWith("agent-x", {
        exitCode: 127,
        signal: null,
        stderr: ["command not found"],
      })

      await monitor.stopAndAssertClean()
    })

    it("does not leak uncaught errors when late async error fires after entry removed", async () => {
      // This is the trickiest case: connect resolves (pid is set, entry in map),
      // and THEN an async error event fires — the registered error handler
      // must swallow it without any uncaught escape.
      const monitor = withUncaughtMonitor()
      monitor.start()

      spawnBehavior = { kind: "success", port: 7100 }

      const { createConnectionRegistry } = await import("../src/acp/connection-registry")
      const reg = createConnectionRegistry()

      await reg.connect("agent-late-err", "opencode", { cwd: "/tmp" })

      // Remove entry from map (simulate close/kill)
      await reg.close("agent-late-err")

      // Now fire a late error on the child — should NOT escape
      const { spawn } = await import("node:child_process")
      const child = vi.mocked(spawn).mock.results[0]?.value as MockChild
      const lateErr = Object.assign(new Error("late spawn error"), { code: "ENOENT" })
      child.emit("error", lateErr)

      await monitor.stopAndAssertClean()
    })
  })

  describe("at orchestrator layer (end-to-end)", () => {
    it("createAndSpawn → returns rejection to caller, BE process untouched", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      const { createAgentOrchestrator } = await import("../src/app/agent-orchestrator")
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      type CrashCb = (agentId: string, info: any) => void
      const crashListeners: CrashCb[] = []

      // connectionRegistry mock: connect() always throws (simulates spawn failure)
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const connectionRegistry: any = {
        connect: vi.fn(async (_agentId: string) => {
          throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
        }),
        get: vi.fn(() => undefined),
        markAttached: vi.fn(),
        markDetached: vi.fn(),
        getRuntimeInfo: vi.fn(() => null),
        close: vi.fn(async () => {}),
        onCrash: vi.fn((cb: CrashCb) => {
          crashListeners.push(cb)
          return () => {}
        }),
      }

      // Minimal registry stub
      const agents = new Map<string, { id: string; status: string; cwd: string; cliKind: string }>()
      const registry = {
        async create(input: { cliKind: string; cwd: string }) {
          const a = { id: crypto.randomUUID(), status: "starting", ...input }
          agents.set(a.id, a)
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          return a as any
        },
        async get(id: string) {
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          return (agents.get(id) ?? null) as any
        },
        async list() {
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          return [...agents.values()] as any
        },
        async update(id: string, patch: Record<string, unknown>) {
          const a = agents.get(id)
          if (!a) return null as unknown as ReturnType<(typeof registry)["get"]>
          Object.assign(a, patch)
          // biome-ignore lint/suspicious/noExplicitAny: test stub
          return a as any
        },
        async delete(id: string) {
          agents.delete(id)
        },
      }

      // biome-ignore lint/suspicious/noExplicitAny: test stub
      const orch = createAgentOrchestrator({ registry: registry as any, connectionRegistry })

      await expect(
        orch.createAndSpawn({ cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
      ).rejects.toThrow(/spawn failed/)

      // Agent should be marked crashed in registry
      const ag = [...agents.values()][0]
      expect(ag?.status).toBe("crashed")

      await monitor.stopAndAssertClean()
    })
  })
})
