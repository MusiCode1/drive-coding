/**
 * spawn-core.test.ts — unit tests for the generic spawn-core.
 *
 * Uses a fake binary (process.execPath = node/bun) with OPENCODE_ARGS override
 * to run a test script, verifying onLine / onFrame / shapeEnv hooks are called
 * through BOTH spawn paths (spawn + spawnWithStderr).
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createSpawnCore } from "./spawn-core.js"

let spawnedChildren: ChildProcessWithoutNullStreams[] = []

/** Script that stays alive (used for lifecycle tests). */
let aliveScriptPath: string | null = null

/** Script that writes a JSON line then stays alive (used for onLine/onFrame tests). */
let echoScriptPath: string | null = null

function getAliveScript(): string {
  if (!aliveScriptPath) {
    aliveScriptPath = path.join(os.tmpdir(), "spawn-core-alive.mjs")
    fs.writeFileSync(aliveScriptPath, "setInterval(() => {}, 99999);\n", "utf8")
  }
  return aliveScriptPath
}

function getEchoScript(line: string): string {
  echoScriptPath = path.join(os.tmpdir(), "spawn-core-echo.mjs")
  fs.writeFileSync(
    echoScriptPath,
    `process.stdout.write(${JSON.stringify(`${line}\n`)});\nsetInterval(() => {}, 99999);\n`,
    "utf8",
  )
  return echoScriptPath
}

/**
 * Script that spawns a detached grandchild (own process group) and writes its
 * pid to gpidFile — used to verify kill-tree kills the WHOLE group, not just
 * the direct child (be-shutdown-hardening Commit 0).
 */
function getGrandchildScript(gpidFile: string): string {
  const scriptPath = path.join(os.tmpdir(), "spawn-core-grandchild.mjs")
  fs.writeFileSync(
    scriptPath,
    [
      'import { spawn } from "node:child_process"',
      'import fs from "node:fs"',
      `const gp = spawn(process.execPath, ["-e", "setInterval(() => {}, 99999)"], { stdio: "ignore" })`,
      `fs.writeFileSync(${JSON.stringify(gpidFile)}, String(gp.pid))`,
      "setInterval(() => {}, 99999);",
      "",
    ].join("\n"),
    "utf8",
  )
  return scriptPath
}

/** Set env vars so OPENCODE_BIN=node and OPENCODE_ARGS=[scriptPath]. Returns cleanup fn. */
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

async function spawnBridge(
  core: ReturnType<typeof createSpawnCore>,
  id: string,
  scriptPath?: string,
): Promise<ChildProcessWithoutNullStreams> {
  const cleanup = useScript(scriptPath ?? getAliveScript())
  try {
    const handle = await core.spawnWithStderr(id, {
      cliKind: "opencode",
      cwd: os.tmpdir(),
      modelOverride: null,
    })
    spawnedChildren.push(handle.child)
    return handle.child
  } finally {
    cleanup()
  }
}

describe("spawn-core — hooks and lifecycle", () => {
  beforeEach(() => {
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
          /* already dead */
        }
        waiting.push(exitPromise)
      }
    }
    await Promise.all(waiting)
    spawnedChildren = []
  })

  it("createSpawnCore returns required interface", () => {
    const core = createSpawnCore()
    expect(typeof core.spawn).toBe("function")
    expect(typeof core.spawnWithStderr).toBe("function")
    expect(typeof core.kill).toBe("function")
    expect(typeof core.get).toBe("function")
    expect(typeof core.list).toBe("function")
    expect(typeof core.onCrash).toBe("function")
    expect(typeof core.onLine).toBe("function")
    expect(typeof core.writeStdin).toBe("function")
    expect(typeof core.getChild).toBe("function")
  })

  it("get/getChild return null for unknown bridge", () => {
    const core = createSpawnCore()
    expect(core.get("unknown")).toBeNull()
    expect(core.getChild("unknown")).toBeNull()
    expect(core.writeStdin("unknown", "hi\n")).toBe(false)
  })

  it("spawned bridge appears in get() and list()", async () => {
    const core = createSpawnCore()
    await spawnBridge(core, "list-test-1")
    expect(core.get("list-test-1")).not.toBeNull()
    expect(core.list().some((h) => h.bridgeId === "list-test-1")).toBe(true)
  })

  it("getChild returns live process after spawn", async () => {
    const core = createSpawnCore()
    await spawnBridge(core, "child-test-1")
    const child = core.getChild("child-test-1")
    expect(child).not.toBeNull()
    expect(child?.pid).toBeGreaterThan(0)
  })

  it("throws on duplicate bridgeId", async () => {
    const core = createSpawnCore()
    await spawnBridge(core, "dup-1")
    const cleanup = useScript(getAliveScript())
    try {
      await expect(
        core.spawn("dup-1", { cliKind: "opencode", cwd: os.tmpdir(), modelOverride: null }),
      ).rejects.toThrow("already exists")
    } finally {
      cleanup()
    }
  })

  it("kill removes bridge from store", async () => {
    const core = createSpawnCore()
    await spawnBridge(core, "kill-test-1")
    expect(core.get("kill-test-1")).not.toBeNull()
    await core.kill("kill-test-1")
    expect(core.get("kill-test-1")).toBeNull()
  })

  // POSIX-only: kill-tree relies on process.kill(-pid) group semantics, which
  // requires the child to be spawned with detached:true (Commit 0). Windows
  // uses `taskkill /T` — verified live in the DoD (calev), not unit-testable here.
  it.skipIf(process.platform === "win32")(
    "kill() kills the whole process group — grandchild dies too (POSIX)",
    async () => {
      const gpidFile = path.join(os.tmpdir(), `spawn-core-gpid-${Date.now()}.txt`)
      const scriptPath = getGrandchildScript(gpidFile)
      const core = createSpawnCore()
      const cleanup = useScript(scriptPath)
      let child: ChildProcessWithoutNullStreams
      try {
        const handle = await core.spawnWithStderr("killtree-1", {
          cliKind: "opencode",
          cwd: os.tmpdir(),
          modelOverride: null,
        })
        child = handle.child
      } finally {
        cleanup()
      }
      spawnedChildren.push(child)

      // Wait for the grandchild to write its pid.
      let gpid = 0
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(() => resolve(), 2000)
        const interval = setInterval(() => {
          if (fs.existsSync(gpidFile)) {
            const content = fs.readFileSync(gpidFile, "utf8").trim()
            if (content) {
              gpid = Number(content)
              clearInterval(interval)
              clearTimeout(deadline)
              resolve()
            }
          }
        }, 20)
      })
      expect(gpid).toBeGreaterThan(0)

      await core.kill("killtree-1")

      // Give the SIGTERM signal a moment to propagate to the grandchild.
      await new Promise((r) => setTimeout(r, 200))

      // ESRCH — process.kill(gpid, 0) throws if the process no longer exists.
      expect(() => process.kill(gpid, 0)).toThrow()

      fs.rmSync(gpidFile, { force: true })
    },
  )

  it("shapeEnv hook called via spawn()", async () => {
    const calls: string[] = []
    const core = createSpawnCore({
      shapeEnv(cliKind, baseEnv) {
        calls.push(cliKind)
        return baseEnv
      },
    })
    await spawnBridge(core, "shapeenv-spawn")
    expect(calls).toEqual(["opencode"])
  })

  it("shapeEnv hook called via spawnWithStderr()", async () => {
    const calls: string[] = []
    const core = createSpawnCore({
      shapeEnv(cliKind, baseEnv) {
        calls.push(cliKind)
        return baseEnv
      },
    })
    await spawnBridge(core, "shapeenv-stderr")
    expect(calls).toEqual(["opencode"])
  })

  it("spawnWithStderr returns getStderr() and child", async () => {
    const core = createSpawnCore()
    const cleanup = useScript(getAliveScript())
    let handle: Awaited<ReturnType<typeof core.spawnWithStderr>>
    try {
      handle = await core.spawnWithStderr("stderr-1", {
        cliKind: "opencode",
        cwd: os.tmpdir(),
        modelOverride: null,
      })
    } finally {
      cleanup()
    }
    spawnedChildren.push(handle.child)
    expect(typeof handle.getStderr).toBe("function")
    expect(handle.child).toBeDefined()
    expect(handle.pid).toBeGreaterThan(0)
  })

  it("onFrame(out) called verbatim (with \\n) via writeStdin", async () => {
    const frames: string[] = []
    const core = createSpawnCore({
      onFrame(_id, dir, rawLine) {
        if (dir === "out") frames.push(rawLine)
      },
    })
    await spawnBridge(core, "frame-out-1")
    const msg = '{"method":"test"}\n'
    core.writeStdin("frame-out-1", msg)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toBe(msg) // verbatim — includes \n; wrapper normalizes
  })

  it("onFrame(out) called without \\n when writeStdin sends no \\n", async () => {
    const frames: string[] = []
    const core = createSpawnCore({
      onFrame(_id, dir, rawLine) {
        if (dir === "out") frames.push(rawLine)
      },
    })
    await spawnBridge(core, "frame-out-2")
    const msg = '{"method":"test"}'
    core.writeStdin("frame-out-2", msg)
    expect(frames[0]).toBe(msg)
  })

  it("onFrame(in) called without \\n when child writes line to stdout", async () => {
    const testLine = '{"method":"session/update","id":"t1"}'
    const scriptPath = getEchoScript(testLine)
    const inFrames: string[] = []

    const core = createSpawnCore({
      onFrame(_id, dir, rawLine) {
        if (dir === "in") inFrames.push(rawLine)
      },
    })

    const cleanup = useScript(scriptPath)
    let child: ChildProcessWithoutNullStreams
    try {
      const handle = await core.spawnWithStderr("frame-in-1", {
        cliKind: "opencode",
        cwd: os.tmpdir(),
        modelOverride: null,
      })
      child = handle.child
      spawnedChildren.push(child)
    } finally {
      cleanup()
    }

    // Wait up to 2s for the frame to arrive.
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => resolve(), 2000)
      const interval = setInterval(() => {
        if (inFrames.length > 0) {
          clearInterval(interval)
          clearTimeout(deadline)
          resolve()
        }
      }, 20)
    })

    expect(inFrames.length).toBeGreaterThan(0)
    expect(inFrames[0]).toBe(testLine) // no \n
  })

  it("onLine subscriber called BEFORE onFrame for stdout lines", async () => {
    const testLine = '{"method":"session/update","id":"t2"}'
    const scriptPath = getEchoScript(testLine)
    const order: string[] = []

    const core = createSpawnCore({
      onFrame(_id, dir) {
        if (dir === "in") order.push("onFrame")
      },
    })

    const cleanup = useScript(scriptPath)
    let child: ChildProcessWithoutNullStreams
    try {
      const handle = await core.spawnWithStderr("order-test-1", {
        cliKind: "opencode",
        cwd: os.tmpdir(),
        modelOverride: null,
      })
      child = handle.child
      spawnedChildren.push(child)
    } finally {
      cleanup()
    }

    core.onLine("order-test-1", () => {
      order.push("onLine")
    })

    // Wait for the line.
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => resolve(), 2000)
      const interval = setInterval(() => {
        if (order.length >= 2) {
          clearInterval(interval)
          clearTimeout(deadline)
          resolve()
        }
      }, 20)
    })

    // subscribers (onLine) must fire BEFORE onFrame.
    expect(order).toEqual(["onLine", "onFrame"])
  })

  it("onCrash called when child exits unexpectedly", async () => {
    // Script that exits immediately.
    const exitScript = path.join(os.tmpdir(), "spawn-core-exit.mjs")
    fs.writeFileSync(exitScript, "process.exit(1);\n", "utf8")

    const crashIds: string[] = []
    const core = createSpawnCore()
    core.onCrash((id) => {
      crashIds.push(id)
    })

    const cleanup = useScript(exitScript)
    let child: ChildProcessWithoutNullStreams
    try {
      const handle = await core.spawnWithStderr("crash-1", {
        cliKind: "opencode",
        cwd: os.tmpdir(),
        modelOverride: null,
      })
      child = handle.child
    } finally {
      cleanup()
    }

    // Wait for exit.
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve()
        return
      }
      child.once("exit", () => resolve())
      child.once("error", () => resolve())
    })

    // Give the exit event handler time to run.
    await new Promise((r) => setTimeout(r, 50))

    expect(crashIds).toContain("crash-1")
    expect(core.get("crash-1")).toBeNull()
  })
})
