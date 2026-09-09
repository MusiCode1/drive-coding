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
  agentSocketPath,
  listAgentSockets,
  MAX_SOCKET_PATH,
  probeAgentSocket,
  readAgentMeta,
  SocketPathTooLongError,
  writeAgentMeta,
} from "../src/agents/agent-sockets.js"
import {
  deploymentDir,
  deploymentName,
  ensureDeploymentDir,
  snapshotPathIn,
} from "../src/agents/deployment-dir.js"

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

describe("deploymentDir", () => {
  it("prefers XDG_RUNTIME_DIR and names the directory after the deployment", () => {
    expect(deploymentDir({ XDG_RUNTIME_DIR: "/run/user/1001", DC_DEPLOYMENT: "edge" }, 4000)).toBe(
      "/run/user/1001/drive-coding/deployments/edge",
    )
  })

  it("🔴 defaults to the port, so an unconfigured backend stays isolated", () => {
    // The port used to be the identity. Keeping it as the *default* preserves
    // the isolation dev/edge/main relied on, without making it permanent.
    const env = { XDG_RUNTIME_DIR: "/run/user/1001" }
    expect(deploymentDir({ ...env, PORT: "4001" }, 4000)).not.toBe(
      deploymentDir({ ...env, PORT: "4002" }, 4000),
    )
    expect(deploymentName({ PORT: "4002" }, 4000)).toBe("4002")
  })

  it("🔴 a name survives a port change — which is what the port could not do", () => {
    // Move a deployment to another port and its agents must come with it.
    // Keyed by port, they were instantly orphaned.
    const a = deploymentDir({ XDG_RUNTIME_DIR: "/r", DC_DEPLOYMENT: "edge", PORT: "4002" }, 4000)
    const b = deploymentDir({ XDG_RUNTIME_DIR: "/r", DC_DEPLOYMENT: "edge", PORT: "4004" }, 4000)
    expect(a).toBe(b)
  })

  it("two deployments can be pointed at one directory on purpose", () => {
    const shared = "/run/user/1001/drive-coding/deployments/handover"
    expect(deploymentDir({ DC_DEPLOYMENT_DIR: shared, PORT: "4002" }, 4000)).toBe(shared)
    expect(deploymentDir({ DC_DEPLOYMENT_DIR: shared, PORT: "4004" }, 4000)).toBe(shared)
  })

  it("falls back to the state dir when XDG_RUNTIME_DIR is absent or empty", () => {
    for (const env of [{}, { XDG_RUNTIME_DIR: "" }]) {
      const dir = deploymentDir({ ...env, DC_DEPLOYMENT: "edge" }, 4000)
      expect(dir).not.toContain("/run/user")
      expect(dir.endsWith("deployments/edge")).toBe(true)
    }
  })

  it("creates the directory private", () => {
    const dir = join(tmpDir(), "nested", "edge")
    ensureDeploymentDir(dir)
    expect(existsSync(dir)).toBe(true)
  })

  it("the snapshot sits beside the sockets it describes", () => {
    expect(snapshotPathIn("/r/deployments/edge")).toBe("/r/deployments/edge/agents.json")
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
      deploymentDir({ XDG_RUNTIME_DIR: "/run/user/1001", DC_DEPLOYMENT: "edge" }, 4000),
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

  it("🔴 reaping a stale socket takes its meta with it", async () => {
    // A SIGKILLed sidecar runs no cleanup and leaves both files. Removing only
    // the socket left a .json per hard kill, each naming a pid that may since
    // have been recycled onto some unrelated process.
    const dir = tmpDir()
    const id = "88888888-8888-4888-8888-888888888888"
    writeFileSync(agentSocketPath(dir, id), "")
    writeAgentMeta(dir, {
      agentId: id,
      cliKind: "cursor",
      cwd: "/tmp",
      pid: 999999,
      startedAt: "2026-09-09T10:00:00.000Z",
    })
    expect(readAgentMeta(dir, id)).not.toBeNull()

    expect((await probeAgentSocket(agentSocketPath(dir, id))).state).toBe("stale")
    expect(existsSync(agentSocketPath(dir, id))).toBe(false)
    expect(readAgentMeta(dir, id)).toBeNull()
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

  it("🔴 a missing path is `absent`, not `unknown` — the distinction gates launching", async () => {
    // Folding these together is what lets a launcher start a second sidecar on
    // top of a live one: "I could not reach it" is not "nothing is there".
    const res = await probeAgentSocket(join(tmpDir(), "gone.sock"))
    expect(res.state).toBe("absent")
  })

  it("never throws, whatever it is pointed at", async () => {
    const dir = tmpDir()
    mkdirSync(join(dir, "a-directory.sock"))
    // Measured: connect(2) to a directory answers ECONNREFUSED, same as a dead
    // socket — so it lands in `stale`. That is still safe: the probe's unlink
    // fails with EISDIR, and listenUnix then refuses to bind with a real error
    // rather than pretending the path is usable.
    expect((await probeAgentSocket(join(dir, "a-directory.sock"))).state).toBe("stale")
  })
})
