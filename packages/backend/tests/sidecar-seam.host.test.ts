/**
 * sidecar-seam.host.test.ts — the seam holds: a session host driven over a socket.
 *
 * `connectSidecar` is only worth anything if everything above `ProviderConnection`
 * keeps working untouched. This drives the real stack end to end —
 *
 *   createSessionHostFromConnection → AcpClient → connectSidecar → socket
 *     → agent-sidecar (its own process) → a minimal ACP agent fixture
 *
 * — with no test doubles in between. The fixture is deterministic so the
 * assertion can be on exact text rather than on a model's mood.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { connectSidecar } from "@drive-coding/provider/connection"
import { afterEach, describe, expect, it } from "vitest"
import { createSessionHostFromConnection } from "../src/session-host/session-host.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const sidecarEntry = join(repoRoot, "packages", "backend", "src", "bin", "agent-sidecar.ts")
const acpFixture = join(here, "fixtures", "fake-acp-agent.mjs")

const kids: ChildProcess[] = []
const dirs: string[] = []

async function startSidecar(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "seam-"))
  dirs.push(dir)
  const socket = join(dir, "a.sock")
  const child = spawn(
    "bun",
    [
      sidecarEntry,
      "--agent-id",
      "seam-agent",
      "--cli-kind",
      "cursor",
      "--cwd",
      tmpdir(),
      "--socket",
      socket,
    ],
    {
      env: {
        ...process.env,
        CLI_SPECS_JSON: JSON.stringify({ cursor: { bin: "node", args: [acpFixture] } }),
        LOG_LEVEL: "silent",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  kids.push(child)

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (existsSync(socket)) return socket
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("sidecar never bound its socket")
}

afterEach(() => {
  for (const k of kids) k.kill("SIGKILL")
  kids.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("session host over a sidecar", () => {
  it("🔴 initializes, opens a session and runs a turn — no changes above the seam", async () => {
    const socket = await startSidecar()
    const conn = await connectSidecar({ socketPath: socket, cliKind: "cursor" })
    const host = await createSessionHostFromConnection(conn)

    const { sessionId } = await host.newSession({ cwd: tmpdir(), mcpServers: [] })
    expect(sessionId).toBe("fixture-session-1")

    await host.prompt(sessionId, "hello")

    const state = host.state
    const text = JSON.stringify(state)
    expect(text).toContain("FIXTURE-REPLY")
    expect(state.turnState).toBe("idle")

    await host.dispose()
    await conn.close()
  }, 40000)

  it("🔴 the agent outlives the host that was driving it", async () => {
    // The property the slice exists for, exercised through the real host rather
    // than a raw socket: dispose everything the backend owns, then attach a
    // second host to the same sidecar and keep working.
    const socket = await startSidecar()

    const first = await connectSidecar({ socketPath: socket, cliKind: "cursor" })
    const hostA = await createSessionHostFromConnection(first)
    const { sessionId } = await hostA.newSession({ cwd: tmpdir(), mcpServers: [] })
    await hostA.prompt(sessionId, "first")
    await hostA.dispose()
    await first.close()

    await new Promise((r) => setTimeout(r, 100))
    expect(existsSync(socket)).toBe(true)

    const second = await connectSidecar({ socketPath: socket, cliKind: "cursor" })
    const hostB = await createSessionHostFromConnection(second)
    const again = await hostB.newSession({ cwd: tmpdir(), mcpServers: [] })
    await hostB.prompt(again.sessionId, "second")

    expect(JSON.stringify(hostB.state)).toContain("FIXTURE-REPLY")
    await hostB.dispose()
    await second.close()
  }, 40000)
})
