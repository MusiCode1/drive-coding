/**
 * agent-sockets.discovery.test.ts — paths, listing, and what a probe concludes.
 *
 * The probe tests use real `node:net` servers rather than mocks: the whole point
 * is what the OS does with a socket whose listener is gone, and a mock would
 * only assert what we already believe.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodePing, encodePong } from "@drive-coding/acp-wire"
import { afterEach, describe, expect, it } from "vitest"
import {
  agentSocketDir,
  agentSocketPath,
  ensureAgentSocketDir,
  listAgentSockets,
  MAX_SOCKET_PATH,
  probeAgentSocket,
  SocketPathTooLongError,
} from "../src/agents/agent-sockets.js"

const dirs: string[] = []
const servers: Server[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "agent-sock-"))
  dirs.push(d)
  return d
}

/** A listener that answers `_drive/ping`, like a real sidecar. */
function fakeSidecar(path: string, info?: Record<string, unknown>): Promise<Server> {
  const srv = createServer((sock) => {
    sock.on("data", (b: Buffer) => {
      for (const line of b.toString("utf8").split("\n")) {
        const ping = decodePing(line)
        if (ping !== null) sock.write(encodePong(ping.id, info))
      }
    })
  })
  servers.push(srv)
  return new Promise((res) => srv.listen(path, () => res(srv)))
}

/** A listener that accepts and never answers — a blocked event loop. */
function wedgedSidecar(path: string): Promise<Server> {
  const srv = createServer(() => {})
  servers.push(srv)
  return new Promise((res) => srv.listen(path, () => res(srv)))
}

afterEach(() => {
  for (const s of servers) s.close()
  servers.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("agentSocketDir", () => {
  it("prefers XDG_RUNTIME_DIR and keys the directory by port", () => {
    const dir = agentSocketDir(4002, { XDG_RUNTIME_DIR: "/run/user/1001" })
    expect(dir).toBe("/run/user/1001/drive-coding/agents-4002")
  })

  it("🔴 two deployments never share a directory", () => {
    const env = { XDG_RUNTIME_DIR: "/run/user/1001" }
    expect(agentSocketDir(4001, env)).not.toBe(agentSocketDir(4002, env))
  })

  it("falls back to the state dir when XDG_RUNTIME_DIR is absent or empty", () => {
    for (const env of [{}, { XDG_RUNTIME_DIR: "" }]) {
      const dir = agentSocketDir(4002, env)
      expect(dir).not.toContain("/run/user")
      expect(dir.endsWith("agents-4002")).toBe(true)
    }
  })

  it("creates the directory private", () => {
    const dir = join(tmpDir(), "nested", "agents-4002")
    ensureAgentSocketDir(dir)
    expect(existsSync(dir)).toBe(true)
  })
})

describe("agentSocketPath", () => {
  it("derives the name from the agent id — no index needed", () => {
    expect(agentSocketPath("/run/x", "abc")).toBe("/run/x/abc.sock")
  })

  it("🔴 refuses a path over the sun_path limit, naming the length", () => {
    // Measured: bind succeeds at 108 bytes and fails with EINVAL at 109, from
    // deep inside listen(). Catching it here keeps the error near the cause.
    const deep = `/${"x".repeat(MAX_SOCKET_PATH)}`
    expect(() => agentSocketPath(deep, "id")).toThrow(SocketPathTooLongError)
    expect(() => agentSocketPath(deep, "id")).toThrow(/sun_path limit/)
  })

  it("our real-world path is comfortably inside the limit", () => {
    const path = agentSocketPath(
      agentSocketDir(4002, { XDG_RUNTIME_DIR: "/run/user/1001" }),
      "11111111-1111-4111-8111-111111111111",
    )
    expect(path.length).toBeLessThan(MAX_SOCKET_PATH)
  })
})

describe("listAgentSockets", () => {
  it("returns ids, ignoring anything that is not a socket file", () => {
    const dir = tmpDir()
    writeFileSync(join(dir, "aaa.sock"), "")
    writeFileSync(join(dir, "bbb.sock"), "")
    writeFileSync(join(dir, "notes.txt"), "")
    expect(listAgentSockets(dir).sort()).toEqual(["aaa", "bbb"])
  })

  it("a missing directory is empty, not an error", () => {
    expect(listAgentSockets(join(tmpdir(), "no-such-dir-9z"))).toEqual([])
  })
})

describe("probeAgentSocket", () => {
  it("reports alive when the peer answers a ping", async () => {
    const path = join(tmpDir(), "a.sock")
    await fakeSidecar(path)
    expect(await probeAgentSocket(path)).toEqual({ state: "alive" })
  })

  it("carries the identity the peer attached", async () => {
    const path = join(tmpDir(), "a.sock")
    await fakeSidecar(path, { agentId: "abc", cliKind: "cursor", pid: 7 })
    expect(await probeAgentSocket(path)).toEqual({
      state: "alive",
      info: { agentId: "abc", cliKind: "cursor", pid: 7 },
    })
  })

  it("🔴 a bound-but-silent peer is wedged, not alive", async () => {
    // The distinction connect() alone cannot make: the kernel completes the
    // handshake into the backlog whether or not the process is running.
    const path = join(tmpDir(), "a.sock")
    await wedgedSidecar(path)
    expect(await probeAgentSocket(path, 150)).toEqual({ state: "wedged" })
  })

  it("🔴 a socket file whose listener is gone is stale — and gets unlinked", async () => {
    const dir = tmpDir()
    const path = join(dir, "a.sock")
    const srv = await fakeSidecar(path)
    await new Promise<void>((r) => srv.close(() => r()))
    // Recreate the inode the way a SIGKILL'd process would leave it behind.
    writeFileSync(path, "")
    expect(existsSync(path)).toBe(true)

    expect(await probeAgentSocket(path)).toEqual({ state: "stale" })
    expect(existsSync(path)).toBe(false)
  })

  it("a missing path is unknown, not stale — nothing to clean up", async () => {
    const res = await probeAgentSocket(join(tmpDir(), "gone.sock"))
    expect(res.state).toBe("unknown")
  })

  it("never throws, whatever it is pointed at", async () => {
    const dir = tmpDir()
    mkdirSync(join(dir, "a-directory.sock"))
    await expect(probeAgentSocket(join(dir, "a-directory.sock"))).resolves.toBeDefined()
  })
})
