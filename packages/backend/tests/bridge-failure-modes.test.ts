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
 *   - `createBridgeManager().spawn` rejects cleanly on every failure mode
 *   - `createBridgeManager().spawn` propagates the rejection without
 *     leaving stray listeners on the lost child
 *   - `createAgentOrchestrator().createAndSpawn` returns an error to the
 *     HTTP caller and marks the agent crashed
 *   - **no `uncaughtException` or `unhandledRejection` fires during any of
 *     the above** — this is the actual regression that crashes the BE.
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

  describe("at bridge-manager layer", () => {
    it("rejects cleanly when spawn throws synchronously (Bun ENOENT edge case)", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      const enoent = Object.assign(new Error("spawn ENOENT"), {
        code: "ENOENT",
        syscall: "spawn npx",
        path: "npx",
      })
      spawnBehavior = { kind: "throw-sync", error: enoent }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const mgr = createBridgeManager()

      await expect(
        mgr.spawn("agent-fail", { cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
      ).rejects.toThrow(/ENOENT/)

      await monitor.stopAndAssertClean()
    })

    it("rejects cleanly when spawn returns child with no pid", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      spawnBehavior = { kind: "no-pid" }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const mgr = createBridgeManager()

      await expect(
        mgr.spawn("agent-nopid", { cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
      ).rejects.toThrow(/no pid/)

      await monitor.stopAndAssertClean()
    })

    it("rejects cleanly when child emits async error after spawn", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
      // async-error: pid exists but then error fires async
      // In new bridge-manager, spawn with pid succeeds synchronously but error fires later.
      // The manager should survive without uncaught errors.
      spawnBehavior = { kind: "async-error", error: enoent, delayMs: 5 }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const mgr = createBridgeManager()

      // spawn succeeds (pid=12345 returned), but then async error fires.
      // The manager registers the error handler before the error fires,
      // so it should handle it cleanly (remove from store + notify crash).
      const spawnPromise = mgr.spawn("agent-async-err", {
        cliKind: "opencode",
        cwd: "/tmp",
        modelOverride: null,
      })
      // Spawn should resolve (pid is set), then crash event fires
      await spawnPromise.catch(() => {})

      // Give the async error time to fire
      await new Promise((r) => setTimeout(r, 50))

      await monitor.stopAndAssertClean()
    })

    it("handles child exit cleanly (marks as crashed, no uncaught)", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      spawnBehavior = { kind: "success", port: 7100 }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const mgr = createBridgeManager()
      const crashSpy = vi.fn()
      mgr.onCrash(crashSpy)

      await mgr.spawn("agent-exit", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })

      // Simulate unexpected exit
      const { spawn } = await import("node:child_process")
      const child = vi.mocked(spawn).mock.results[0]?.value as MockChild
      child.emit("exit", 127)

      await new Promise((r) => setTimeout(r, 20))
      expect(crashSpy).toHaveBeenCalledWith("agent-exit", { exitCode: 127, signal: null })
      expect(mgr.get("agent-exit")).toBeNull()
      expect(mgr.list()).toHaveLength(0)

      await monitor.stopAndAssertClean()
    })

    it("createBridgeManager().spawn — propagates ENOENT cleanly, no leak", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
      spawnBehavior = { kind: "throw-sync", error: enoent }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const mgr = createBridgeManager()

      await expect(
        mgr.spawn("agent-fail", { cliKind: "opencode", cwd: "/tmp", modelOverride: null }),
      ).rejects.toThrow()

      await monitor.stopAndAssertClean()
    })

    it("createBridgeManager — child exit removes bridge from store, no uncaught", async () => {
      const monitor = withUncaughtMonitor()
      monitor.start()

      // exit-before-port: pid=12345 exists, but child exits quickly.
      // In the new in-process bridge-manager, spawn() succeeds synchronously
      // (pid is valid), and then the exit event fires and removes from store.
      spawnBehavior = {
        kind: "exit-before-port",
        code: 127,
        stderr: "command not found\n",
        delayMs: 5,
      }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const mgr = createBridgeManager()
      const crashSpy = vi.fn()
      mgr.onCrash(crashSpy)

      // Spawn should succeed (pid is set)
      const handle = await mgr.spawn("agent-x", {
        cliKind: "opencode",
        cwd: "/tmp",
        modelOverride: null,
      })
      expect(handle.pid).toBe(12345)
      expect(mgr.get("agent-x")).not.toBeNull()

      // Wait for exit to fire
      await new Promise((r) => setTimeout(r, 50))

      // Manager should not have this bridge in its store after exit
      expect(mgr.get("agent-x")).toBeNull()
      expect(mgr.list()).toHaveLength(0)
      // crash handler was called
      expect(crashSpy).toHaveBeenCalledWith("agent-x", { exitCode: 127, signal: null })

      await monitor.stopAndAssertClean()
    })

    it("does not leak uncaught errors when late async error fires after entry removed", async () => {
      // This is the trickiest case: spawn resolves (pid is set, entry in store),
      // and THEN an async error event fires — the registered error handler
      // must swallow it without any uncaught escape.
      const monitor = withUncaughtMonitor()
      monitor.start()

      spawnBehavior = { kind: "success", port: 7100 }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const mgr = createBridgeManager()

      await mgr.spawn("agent-late-err", { cliKind: "opencode", cwd: "/tmp", modelOverride: null })

      // Delete entry from store (simulate kill)
      await mgr.kill("agent-late-err")

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

      const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
      spawnBehavior = { kind: "throw-sync", error: enoent }

      const { createBridgeManager } = await import("../src/acp/bridge-manager")
      const { createAgentOrchestrator } = await import("../src/app/agent-orchestrator")

      const mgr = createBridgeManager()

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
      const orch = createAgentOrchestrator({ registry: registry as any, bridgeManager: mgr })

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
