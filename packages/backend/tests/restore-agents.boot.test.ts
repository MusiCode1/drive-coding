/**
 * restore-agents.boot.test.ts — the boot step, including the half that is easy
 * to forget.
 *
 * Restoring the row is only half of it: everything that serves an agent looks it
 * up in the connection registry first. Measured 2026-09-08 against a live
 * backend — with only the row restored, the agent appeared in `GET /api/agents`
 * and then failed the moment anything touched it.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodePing, encodePong } from "@drive-coding/acp-wire"
import type { Agent } from "@drive-coding/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { agentSocketPath } from "../src/agents/agent-sockets.js"
import { readAgentStore, writeAgentStore } from "../src/agents/agents-store.js"
import { createPersistentAgentRegistry } from "../src/agents/persistent-registry.js"
import { restorePersistedAgents } from "../src/agents/restore-agents.js"

const dirs: string[] = []
const servers: Server[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "restore-"))
  dirs.push(d)
  return d
}

function liveSidecar(path: string): Promise<Server> {
  const srv = createServer((sock) => {
    sock.on("data", (b: Buffer) => {
      for (const line of b.toString("utf8").split("\n")) {
        const ping = decodePing(line)
        if (ping !== null) sock.write(encodePong(ping.id, {}))
      }
    })
  })
  servers.push(srv)
  return new Promise((res) => srv.listen(path, () => res(srv)))
}

const ID = "11111111-1111-4111-8111-111111111111"
const row = (over: Partial<Agent> = {}): Agent => ({
  id: ID,
  cliKind: "cursor",
  cwd: "/tmp",
  modelOverride: null,
  status: "ready",
  createdAt: "2026-09-08T10:00:00.000Z",
  ...over,
})

/** A registry whose snapshot file already holds one agent. */
function registryWithRow(over: Partial<Agent> = {}) {
  const file = join(tmpDir(), "4002.json")
  writeAgentStore(file, [row(over)])
  return { file, registry: createPersistentAgentRegistry({ file }) }
}

afterEach(() => {
  for (const s of servers) s.close()
  servers.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("restorePersistedAgents", () => {
  it("🔴 restores nothing when the sidecar route is off", async () => {
    // Every agent was a child of the process that just died. Probing a
    // directory that will not exist would be theatre.
    const { file, registry } = registryWithRow()
    const connect = vi.fn()

    await restorePersistedAgents({ registry, connections: { connect }, env: { AGENT_SIDECAR: "" } })

    expect(await registry.list()).toEqual([])
    expect(readAgentStore(file)).toEqual([])
    expect(connect).not.toHaveBeenCalled()
  })

  it("🔴 restores the row AND re-attaches its connection", async () => {
    const socketDir = tmpDir()
    await liveSidecar(agentSocketPath(socketDir, ID))
    const { file, registry } = registryWithRow({ acpSessionId: "sess-9" })
    const connect = vi.fn(async () => ({}))

    await restorePersistedAgents({
      registry,
      connections: { connect },
      env: { AGENT_SIDECAR: "cursor" },
      socketDir,
    })

    const live = await registry.list()
    expect(live).toHaveLength(1)
    expect(live[0]?.id).toBe(ID)
    expect(live[0]?.createdAt).toBe("2026-09-08T10:00:00.000Z")
    expect(live[0]?.acpSessionId).toBe("sess-9")
    // 🔴 …and the connection, without which the row is an entry that errors.
    expect(connect).toHaveBeenCalledWith(ID, "cursor", { cwd: "/tmp" })
    expect(readAgentStore(file)).toHaveLength(1)
  })

  it("🔴 does not create a session host — that would risk a second session", async () => {
    // acpSessionIdCache died with the previous process. A host built without a
    // session id takes the cold branch and calls session/new on an agent that
    // may be mid-turn. Connection level only, on purpose.
    const socketDir = tmpDir()
    await liveSidecar(agentSocketPath(socketDir, ID))
    const { registry } = registryWithRow()
    const connect = vi.fn(async () => ({}))

    await restorePersistedAgents({
      registry,
      connections: { connect },
      env: { AGENT_SIDECAR: "cursor" },
      socketDir,
    })

    expect(connect).toHaveBeenCalledOnce()
    // The row comes back as `starting`: the process is real, the session is not.
    expect((await registry.list())[0]?.status).toBe("starting")
  })

  it("an empty snapshot restores immediately and touches nothing", async () => {
    const file = join(tmpDir(), "4002.json")
    const registry = createPersistentAgentRegistry({ file })
    const connect = vi.fn()

    await restorePersistedAgents({
      registry,
      connections: { connect },
      env: { AGENT_SIDECAR: "cursor" },
    })

    expect(await registry.list()).toEqual([])
    expect(connect).not.toHaveBeenCalled()
  })

  it("🔴 a failed re-attach keeps the row rather than losing the agent", async () => {
    // The sidecar is alive; only our connect threw. Dropping the row would make
    // a recoverable agent invisible.
    const socketDir = tmpDir()
    await liveSidecar(agentSocketPath(socketDir, ID))
    const { registry } = registryWithRow()
    const connect = vi.fn(async () => {
      throw new Error("nope")
    })

    await expect(
      restorePersistedAgents({
        registry,
        connections: { connect },
        env: { AGENT_SIDECAR: "cursor" },
        socketDir,
      }),
    ).resolves.toBeUndefined()
    expect(connect).toHaveBeenCalledOnce()
    expect(await registry.list()).toHaveLength(1)
  })

  it("works without a connection registry — restore is still valid on its own", async () => {
    const { registry } = registryWithRow()
    await expect(
      restorePersistedAgents({ registry, env: { AGENT_SIDECAR: "" } }),
    ).resolves.toBeUndefined()
    expect(await registry.list()).toEqual([])
  })

  it("a stale socket file is not mistaken for a live agent", async () => {
    const sockDir = tmpDir()
    writeFileSync(agentSocketPath(sockDir, ID), "")
    const { registry } = registryWithRow()
    const connect = vi.fn()

    await restorePersistedAgents({
      registry,
      connections: { connect },
      env: { AGENT_SIDECAR: "cursor" },
      socketDir: sockDir,
    })
    expect(await registry.list()).toEqual([])
    expect(connect).not.toHaveBeenCalled()
  })
})
