/**
 * spawn.test.ts — integration tests for connectSpawn (CUT-3b-i).
 *
 * Tests use real child processes (node/bun via OPENCODE_BIN+OPENCODE_ARGS override)
 * to verify the full ProviderConnection primitive:
 *   - onFrame receives decoded WireFrame (type/id/dir)
 *   - turn.isBusy() = true during a sessionUpdate stream, idle after debounce
 *   - onCrash fires when the child exits
 *   - wire.write/onLine round-trip
 *   - ext = undefined
 *   - pid is populated after spawn
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { connectSpawn } from "./spawn.js"
import type { ProviderConnection } from "./types.js"

// ── helpers ──────────────────────────────────────────────────────────────────

/** Set OPENCODE_BIN/OPENCODE_ARGS env override for this test. Returns cleanup fn. */
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

/** Write a temp script and return its path. */
function writeTmpScript(name: string, content: string): string {
  const p = path.join(os.tmpdir(), `connectSpawn-test-${name}.mjs`)
  fs.writeFileSync(p, content, "utf8")
  return p
}

/** connectSpawn with OPENCODE_BIN override pointing to a script. */
async function spawnWithScript(
  scriptPath: string,
): Promise<{ conn: ProviderConnection; cleanup: () => void }> {
  const cleanup = useScript(scriptPath)
  const conn = await connectSpawn("opencode", { cwd: os.tmpdir() })
  return { conn, cleanup }
}

// Track spawned connections for cleanup.
const openConnections: ProviderConnection[] = []

beforeEach(() => {
  openConnections.length = 0
})

afterEach(async () => {
  for (const c of openConnections) {
    try {
      await c.close()
    } catch {
      /* already dead */
    }
  }
  openConnections.length = 0
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe("connectSpawn — ProviderConnection primitive", () => {
  it("ext is undefined (spawn-native)", async () => {
    // alive script — stays open
    const script = writeTmpScript("alive-ext", "setInterval(() => {}, 99999);\n")
    const { conn, cleanup } = await spawnWithScript(script)
    openConnections.push(conn)
    try {
      expect(conn.ext).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it("pid is populated after spawn", async () => {
    const script = writeTmpScript("alive-pid", "setInterval(() => {}, 99999);\n")
    const { conn, cleanup } = await spawnWithScript(script)
    openConnections.push(conn)
    try {
      expect(typeof conn.pid).toBe("number")
      expect(conn.pid).toBeGreaterThan(0)
    } finally {
      cleanup()
    }
  })

  it("onFrame receives WireFrame with decoded type/id/dir", async () => {
    // Script emits one JSON-RPC notification then stays alive.
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: "hi" } },
    })
    const script = writeTmpScript(
      "echo-frame",
      `process.stdout.write(${JSON.stringify(`${frame}\n`)});\nsetInterval(() => {}, 99999);\n`,
    )

    const received: import("./types.js").WireFrame[] = []
    const { conn, cleanup } = await spawnWithScript(script)
    openConnections.push(conn)
    try {
      conn.onFrame((f) => received.push(f))

      // Wait up to 2s for frame to arrive.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout waiting for onFrame")), 2000)
        const unsub = conn.onFrame((f) => {
          if (f.type === "agent_message_chunk") {
            clearTimeout(t)
            unsub()
            resolve()
          }
        })
      })

      const f = received.find((f) => f.type === "agent_message_chunk")
      expect(f).toBeDefined()
      expect(f!.dir).toBe("in")
      expect(f!.type).toBe("agent_message_chunk")
      expect(f!.raw).toBe(frame)
    } finally {
      cleanup()
    }
  })

  it("turn.isBusy() = true after sessionUpdate frame arrives", async () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk" } },
    })
    const script = writeTmpScript(
      "busy-turn",
      `process.stdout.write(${JSON.stringify(`${frame}\n`)});\nsetInterval(() => {}, 99999);\n`,
    )

    const { conn, cleanup } = await spawnWithScript(script)
    openConnections.push(conn)
    try {
      // Wait for frame to be processed.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 2000)
        const unsub = conn.onFrame(() => {
          clearTimeout(t)
          unsub()
          resolve()
        })
      })

      expect(conn.turn.isBusy()).toBe(true)
      expect(conn.turn.lastActivityAt()).not.toBeNull()
      expect(conn.turn.lastActivityAt()).toBeGreaterThan(0)
    } finally {
      cleanup()
    }
  })

  it("onCrash fires when child exits", async () => {
    // Script exits immediately.
    const script = writeTmpScript("exit-crash", "process.exit(0);\n")
    const { conn, cleanup } = await spawnWithScript(script)
    openConnections.push(conn)
    try {
      const crashInfo = await new Promise<import("../spawn/index.js").BridgeCrashInfo>(
        (resolve, reject) => {
          const t = setTimeout(() => reject(new Error("timeout waiting for onCrash")), 3000)
          conn.onCrash((info) => {
            clearTimeout(t)
            resolve(info)
          })
        },
      )

      expect(crashInfo).toBeDefined()
      // exitCode 0 = clean exit
      expect(crashInfo.exitCode).toBe(0)
    } finally {
      cleanup()
    }
  })

  it("wire.write + wire.onLine round-trip (stdin echo)", async () => {
    // Script reads stdin and echoes each line back to stdout.
    const script = writeTmpScript(
      "echo-stdin",
      `
import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => process.stdout.write(line + "\\n"));
`.trim(),
    )

    const { conn, cleanup } = await spawnWithScript(script)
    openConnections.push(conn)
    try {
      const echoed: string[] = []
      conn.wire.onLine((l) => echoed.push(l))

      const testMsg = JSON.stringify({ jsonrpc: "2.0", method: "$/ping", id: 1 })
      conn.wire.write(`${testMsg}\n`)

      // Wait up to 2s for the echo.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout waiting for echo")), 2000)
        const unsub = conn.wire.onLine((line) => {
          if (line === testMsg) {
            clearTimeout(t)
            unsub()
            resolve()
          }
        })
      })

      expect(echoed.some((l) => l === testMsg)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("turn.onChange fires when busy state changes", async () => {
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk" } },
    })
    const script = writeTmpScript(
      "onChange-test",
      `process.stdout.write(${JSON.stringify(`${frame}\n`)});\nsetInterval(() => {}, 99999);\n`,
    )

    const { conn, cleanup } = await spawnWithScript(script)
    openConnections.push(conn)
    try {
      const changes: boolean[] = []
      conn.turn.onChange((busy) => changes.push(busy))

      // Wait for frame (which should trigger busy=true change).
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 2000)
        const unsub = conn.onFrame(() => {
          clearTimeout(t)
          unsub()
          resolve()
        })
      })

      // Should have received at least one onChange(true).
      expect(changes.includes(true)).toBe(true)
    } finally {
      cleanup()
    }
  })
})
