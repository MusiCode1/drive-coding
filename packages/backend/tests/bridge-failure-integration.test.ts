/**
 * bridge-failure-integration.test.ts — F-1 regression at the BE process level.
 *
 * Unlike `bridge-failure-modes.test.ts`, which mocks `node:child_process.spawn`
 * and asserts JS-level rejection behavior, this file spawns a REAL backend
 * subprocess and verifies that bad agent-creation requests do not kill it.
 *
 * This is the test that would have caught the original F-1 crash, because
 * the crash was at the Bun runtime / OneCLI / `bun --watch` interaction
 * level — invisible to mocked unit tests.
 *
 * The test:
 *   1. Spawns `bun src/server.ts` on a non-default port with PATH stripped
 *      so `npx` cannot be resolved (replicates the production "ENOENT npx"
 *      case from F-1).
 *   2. Submits a POST /api/agents request that triggers the broken spawn.
 *   3. Asserts the BE returns a 4xx/5xx error (not connection reset).
 *   4. Submits a second request to /api/health to verify the BE is alive.
 *   5. Tears down the subprocess.
 *
 * Marked `slow` because it boots a real subprocess (~3-5s).
 */

import { type ChildProcess, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// Locate the bun binary. The BE uses Bun.serve so it must run under bun.
function findBunBinary(): string | null {
  // If we're already running under bun, process.execPath is the bun binary.
  if (typeof process.versions === "object" && "bun" in process.versions) {
    return process.execPath
  }
  // Otherwise check common install locations
  const candidates = [
    path.join(os.homedir(), ".bun/bin/bun"),
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

const bunBinary = findBunBinary()

// Resolve a free TCP port for the test BE
async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("could not get server address"))
        return
      }
      const { port } = addr
      srv.close(() => resolve(port))
    })
    srv.on("error", reject)
  })
}

async function waitForListening(
  port: number,
  timeoutMs = 10_000,
  pollMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`BE did not start listening on port ${port} within ${timeoutMs}ms`)
}

describe.skipIf(!bunBinary)(
  "F-1 regression (integration): BE process survives spawn failures",
  () => {
    let be: ChildProcess | null = null
    let port = 0
    let beStderr = ""

    beforeAll(async () => {
      if (!bunBinary) throw new Error("bun binary not found — should be skipped")

      port = await getFreePort()

      const backendDir = path.resolve(__dirname, "..")

      // Strip PATH so child `npx`/`opencode` spawns fail with ENOENT.
      // Bun itself is invoked by absolute path so the BE can still start.
      // This replicates the F-1 trigger: PATH does not contain the bridge binary.
      const minimalPath = "/usr/bin:/bin"

      be = spawn(bunBinary, ["src/server.ts"], {
        cwd: backendDir,
        env: {
          ...process.env,
          PORT: String(port),
          PATH: minimalPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })

      be.stdout?.on("data", (chunk: Buffer) => {
        beStderr += `[stdout] ${chunk.toString("utf8")}`
      })
      be.stderr?.on("data", (chunk: Buffer) => {
        beStderr += `[stderr] ${chunk.toString("utf8")}`
      })

      try {
        await waitForListening(port, 10_000)
      } catch (_e) {
        throw new Error(
          `BE failed to start on port ${port}. output:\n${beStderr.slice(0, 2000)}`,
        )
      }
    }, 30_000)

    afterAll(async () => {
      if (be) {
        be.kill("SIGTERM")
        await new Promise((r) => setTimeout(r, 200))
        if (!be.killed) be.kill("SIGKILL")
      }
    })

  it("POST /api/agents with broken PATH (ENOENT) returns 5xx, BE stays alive", async () => {
    // First, confirm BE is alive
    const healthBefore = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(healthBefore.ok).toBe(true)

    // Try to create an agent. With PATH stripped, `npx` lookup will ENOENT.
    const res = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cliKind: "opencode",
        cwd: "/tmp",
      }),
    })

    // We expect a 4xx or 5xx (controlled error response).
    // Critically: the request should COMPLETE — no socket reset, no hang.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(600)
    const body = await res.json()
    expect(body).toHaveProperty("error")

    // Now verify BE is still alive after the failed spawn
    const healthAfter = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(healthAfter.ok).toBe(true)

    // Repeat the failing request — BE should still survive a second crash trigger
    const res2 = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cliKind: "opencode", cwd: "/tmp" }),
    })
    expect(res2.status).toBeGreaterThanOrEqual(400)

    const healthFinal = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(healthFinal.ok).toBe(true)
  }, 30_000)

  it("POST /api/agents with non-existent cwd returns error, BE stays alive", async () => {
    const healthBefore = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(healthBefore.ok).toBe(true)

    const res = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cliKind: "opencode",
        cwd: "/nonexistent/path/that/does/not/exist",
      }),
    })

    expect(res.status).toBeGreaterThanOrEqual(400)

    const healthAfter = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(healthAfter.ok).toBe(true)
  }, 15_000)

  it("POST /api/agents with double-encoded cwd (F-2 trigger) does not crash BE", async () => {
    // Trigger from F-2: FE accidentally double-encodes the path
    const healthBefore = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(healthBefore.ok).toBe(true)

    const res = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cliKind: "opencode",
        cwd: "/%2Fhome%2Fuser%2Fprojects%2Fvoice-acp-v3",
      }),
    })

    expect(res.status).toBeGreaterThanOrEqual(400)

    const healthAfter = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(healthAfter.ok).toBe(true)
  }, 15_000)
})
