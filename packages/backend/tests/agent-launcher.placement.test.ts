/**
 * agent-launcher.placement.test.ts — where a sidecar ends up, and whether we
 * start a second one by accident.
 *
 * The systemd tests run only where there is a user manager, and each one names
 * its own transient unit so a failure cannot strand someone else's.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { decodePing, encodePong } from "@drive-coding/acp-wire"
import { afterEach, describe, expect, it } from "vitest"
import {
  agentUnitName,
  FORWARDED_ENV,
  hasSystemdUser,
  launchOrAttachAgent,
  sidecarEntryPath,
  stopAgentUnit,
} from "../src/agents/agent-launcher.js"
import { agentSocketPath } from "../src/agents/agent-sockets.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const fakeCli = join(here, "fixtures", "fake-acp-cli.mjs")

const dirs: string[] = []
const servers: Server[] = []
const units: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "launcher-"))
  dirs.push(d)
  return d
}

function fakeSidecar(path: string): Promise<Server> {
  const srv = createServer((sock) => {
    sock.on("data", (b: Buffer) => {
      for (const line of b.toString("utf8").split("\n")) {
        const ping = decodePing(line)
        if (ping !== null) sock.write(encodePong(ping.id, { agentId: "fake" }))
      }
    })
  })
  servers.push(srv)
  return new Promise((res) => srv.listen(path, () => res(srv)))
}

/** Accepts and never answers — the wedged case. */
function silentSidecar(path: string): Promise<Server> {
  const srv = createServer(() => {})
  servers.push(srv)
  return new Promise((res) => srv.listen(path, () => res(srv)))
}

afterEach(() => {
  for (const u of units) {
    spawnSync("systemctl", ["--user", "stop", u], { stdio: "ignore" })
    spawnSync("systemctl", ["--user", "reset-failed", u], { stdio: "ignore" })
  }
  units.length = 0
  for (const s of servers) s.close()
  servers.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("launcher contract", () => {
  it("derives a stable unit name so a later stop can find it", () => {
    expect(agentUnitName("abc-123")).toBe("dc-agent-abc-123")
  })

  it("🔴 forwards PATH — a transient unit does not inherit one that works", () => {
    // Measured: a --user unit sees 19 variables and
    // PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin. Neither bun nor
    // the cursor binary is on it, so dropping PATH breaks every launch.
    expect(FORWARDED_ENV).toContain("PATH")
    expect(FORWARDED_ENV).toContain("CLI_SPECS_JSON")
  })

  it("resolves the sidecar entry next to itself, and honours an override", () => {
    expect(sidecarEntryPath({})).toMatch(/bin[/\\]agent-sidecar\.(ts|js)$/)
    expect(sidecarEntryPath({ AGENT_SIDECAR_ENTRY: "/custom/x.ts" })).toBe("/custom/x.ts")
  })

  it("reports no systemd when there is no runtime dir to reach it through", () => {
    expect(hasSystemdUser({ XDG_RUNTIME_DIR: "" })).toBe(false)
    expect(stopAgentUnit("whatever", { XDG_RUNTIME_DIR: "" })).toBe(false)
  })

  it("🔴 attaches to a live sidecar instead of starting a second one", async () => {
    const dir = tmpDir()
    const agentId = randomUUID()
    await fakeSidecar(agentSocketPath(dir, agentId))

    const res = await launchOrAttachAgent({
      agentId,
      cliKind: "cursor",
      cwd: "/tmp",
      socketDir: dir,
    })
    expect(res.kind).toBe("attached")
    expect(res.kind === "attached" && res.probe.state).toBe("alive")
  })

  it("refuses rather than fighting over a socket nobody is answering on", async () => {
    const dir = tmpDir()
    const agentId = randomUUID()
    await silentSidecar(agentSocketPath(dir, agentId))

    const res = await launchOrAttachAgent({
      agentId,
      cliKind: "cursor",
      cwd: "/tmp",
      socketDir: dir,
    })
    expect(res.kind).toBe("failed")
    expect(res.kind === "failed" && res.reason).toMatch(/not responding/)
  })
})

describe.skipIf(!hasSystemdUser())("launcher placement (systemd)", () => {
  it("🔴 lands in its own cgroup, not the caller's", async () => {
    // The property the whole slice rests on. KillMode=control-group means the
    // backend's restart reaches every process in *its* cgroup — so the sidecar
    // must not be in it. `detached: true` opens a process group, not a cgroup,
    // and would not save it.
    const dir = tmpDir()
    const agentId = randomUUID()
    units.push(agentUnitName(agentId))

    const res = await launchOrAttachAgent({
      agentId,
      cliKind: "cursor",
      cwd: tmpdir(),
      socketDir: dir,
      env: {
        ...process.env,
        CLI_SPECS_JSON: JSON.stringify({ cursor: { bin: "node", args: [fakeCli] } }),
      },
    })
    expect(res.kind).toBe("launched")
    expect(res.kind === "launched" && res.unit).toBe(agentUnitName(agentId))

    const cgroup = execFileSync(
      "systemctl",
      ["--user", "show", agentUnitName(agentId), "-p", "ControlGroup", "--value"],
      { encoding: "utf8" },
    ).trim()

    expect(cgroup).toContain(`/${agentUnitName(agentId)}.service`)
    expect(cgroup).not.toContain("drive-coding-edge.service")
    // Sibling under app.slice, not nested inside anything of ours.
    expect(cgroup).toMatch(/app\.slice\/dc-agent-[0-9a-f-]+\.service$/)
  }, 30000)

  it("stopAgentUnit is the kill half of the split, and is safe on a unit that never ran", () => {
    expect(stopAgentUnit(randomUUID())).toBe(false)
  })
})

describe("launching only into a slot that is provably free", () => {
  it("🔴 refuses when the probe could not reach the socket", async () => {
    // `unknown` means "I could not tell", not "nothing is there". Treating the
    // two alike is what puts a second sidecar on top of a live one, leaving the
    // first on an unlinked inode — alive, listening, unreachable.
    const dir = tmpDir()
    const agentId = randomUUID()
    await silentSidecar(agentSocketPath(dir, agentId))

    const res = await launchOrAttachAgent({
      agentId,
      cliKind: "cursor",
      cwd: "/tmp",
      socketDir: dir,
    })
    expect(res.kind).toBe("failed")
    expect(res.kind === "failed" && res.reason).toMatch(/cannot confirm the socket is free/)
  })

  it("proceeds when there is genuinely nothing there", async () => {
    const dir = tmpDir()
    const agentId = randomUUID()
    units.push(agentUnitName(agentId))

    const res = await launchOrAttachAgent({
      agentId,
      cliKind: "cursor",
      cwd: tmpdir(),
      socketDir: dir,
      env: {
        ...process.env,
        CLI_SPECS_JSON: JSON.stringify({ cursor: { bin: "node", args: [fakeCli] } }),
      },
    })
    expect(res.kind).toBe("launched")
  }, 30000)
})
