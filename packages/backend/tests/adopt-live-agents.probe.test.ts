/**
 * adopt-live-agents.probe.test.ts — the join between the snapshot and the sockets.
 *
 * Neither source is sufficient alone: the directory knows who is alive but not
 * who they are, the snapshot knows who they are but not whether they still
 * exist. These tests pin what happens at each of the four combinations.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodePing, encodePong } from "@drive-coding/acp-wire"
import type { Agent } from "@drive-coding/core"
import { afterEach, describe, expect, it } from "vitest"
import { adoptLiveAgents } from "../src/agents/adopt-live-agents.js"
import { agentSocketPath } from "../src/agents/agent-sockets.js"

const dirs: string[] = []
const servers: Server[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "adopt-"))
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

const row = (id: string, over: Partial<Agent> = {}): Agent => ({
  id,
  cliKind: "cursor",
  cwd: "/tmp",
  modelOverride: null,
  status: "ready",
  createdAt: "2026-09-08T10:00:00.000Z",
  ...over,
})

afterEach(() => {
  for (const s of servers) s.close()
  servers.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("adoptLiveAgents", () => {
  it("🔴 adopts a row whose sidecar answers, keeping its identity", async () => {
    const dir = tmpDir()
    const id = "11111111-1111-4111-8111-111111111111"
    await liveSidecar(agentSocketPath(dir, id))

    const adopted = await adoptLiveAgents([row(id, { acpSessionId: "s-1" })], dir)
    expect(adopted).toHaveLength(1)
    expect(adopted[0]?.id).toBe(id)
    expect(adopted[0]?.acpSessionId).toBe("s-1")
    expect(adopted[0]?.createdAt).toBe("2026-09-08T10:00:00.000Z")
  })

  it("🔴 does not claim the session is ready — only the process is", async () => {
    // acpSessionIdCache died with the previous backend. Marking the row "ready"
    // would invite the HTTP path to call session/new on an agent mid-turn and
    // open a second session on it.
    const dir = tmpDir()
    const id = "11111111-1111-4111-8111-111111111111"
    await liveSidecar(agentSocketPath(dir, id))

    const adopted = await adoptLiveAgents([row(id, { status: "busy" })], dir)
    expect(adopted[0]?.status).toBe("starting")
  })

  it("does not adopt a row whose socket is stale, and the probe reaps it", async () => {
    const dir = tmpDir()
    const id = "22222222-2222-4222-8222-222222222222"
    writeFileSync(agentSocketPath(dir, id), "")

    expect(await adoptLiveAgents([row(id)], dir)).toEqual([])
  })

  it("does not adopt a row with no socket at all", async () => {
    const dir = tmpDir()
    expect(await adoptLiveAgents([row("33333333-3333-4333-8333-333333333333")], dir)).toEqual([])
  })

  it("🔴 leaves a live socket with no record alone rather than inventing a row", async () => {
    const dir = tmpDir()
    const id = "44444444-4444-4444-8444-444444444444"
    await liveSidecar(agentSocketPath(dir, id))

    expect(await adoptLiveAgents([], dir)).toEqual([])
  })

  it("adopts only the live ones out of a mixed directory", async () => {
    const dir = tmpDir()
    const alive = "55555555-5555-4555-8555-555555555555"
    const dead = "66666666-6666-4666-8666-666666666666"
    await liveSidecar(agentSocketPath(dir, alive))
    writeFileSync(agentSocketPath(dir, dead), "")

    const adopted = await adoptLiveAgents([row(alive), row(dead)], dir)
    expect(adopted.map((a) => a.id)).toEqual([alive])
  })

  it("an empty socket directory adopts nothing and costs no probes", async () => {
    expect(await adoptLiveAgents([row("77777777-7777-4777-8777-777777777777")], tmpDir())).toEqual(
      [],
    )
  })
})
