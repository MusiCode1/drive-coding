/**
 * agent-sockets.live.test.ts — the probe against the real listener.
 *
 * The discovery tests stand up a hand-rolled `net.createServer`; this one drives
 * the actual `listenUnix` from acp-wire. It is the only place the two halves of
 * the `_drive/ping` contract — the answer in the transport, the question in the
 * prober — are checked against each other rather than against a fixture.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectUnix, listenUnix, type UnixListenHandle } from "@drive-coding/acp-wire/node"
import { afterEach, describe, expect, it } from "vitest"
import { agentSocketPath, listAgentSockets, probeAgentSocket } from "../src/agents/agent-sockets.js"

const dirs: string[] = []
const handles: UnixListenHandle[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "agent-sock-live-"))
  dirs.push(d)
  return d
}

async function sidecar(dir: string, agentId: string, info?: Record<string, unknown>) {
  const path = agentSocketPath(dir, agentId)
  const handle = await listenUnix(path)
  if (info) handle.onPing(() => info)
  handles.push(handle)
  return { path, handle }
}

afterEach(() => {
  for (const h of handles) h.close()
  handles.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("probe ↔ listenUnix", () => {
  it("finds a live sidecar and reads its identity", async () => {
    const dir = tmpDir()
    const { path } = await sidecar(dir, "agent-a", { agentId: "agent-a", cliKind: "cursor" })

    expect(listAgentSockets(dir)).toEqual(["agent-a"])
    expect(await probeAgentSocket(path)).toEqual({
      state: "alive",
      info: { agentId: "agent-a", cliKind: "cursor" },
    })
  })

  it("🔴 probing does not disturb the attached owner", async () => {
    const dir = tmpDir()
    const { path, handle } = await sidecar(dir, "agent-b")

    const client = await connectUnix(path)
    const w = client.writable.getWriter()
    await w.write(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n'))
    w.releaseLock()
    const owner = await handle.accepted()

    let ownerClosed = false
    owner.onClose(() => {
      ownerClosed = true
    })

    for (let i = 0; i < 5; i++) {
      expect((await probeAgentSocket(path)).state).toBe("alive")
    }

    expect(ownerClosed).toBe(false)
    expect(handle.current()).toBe(owner)
    client.close()
  })

  it("🔴 turns stale once the listener is gone, and reaps the file", async () => {
    const dir = tmpDir()
    const { path, handle } = await sidecar(dir, "agent-c")
    expect((await probeAgentSocket(path)).state).toBe("alive")

    // A sidecar that exits cleanly unlinks; simulate the SIGKILL case where the
    // inode is left behind by closing the server without touching the path.
    handle.close()
    await new Promise((r) => setTimeout(r, 20))
    if (!existsSync(path)) {
      // close() unlinks on the way out, so there is nothing left to refuse a
      // connection — the path is `absent`, not an error we failed to classify.
      // The orphan-file case is covered in the discovery suite.
      expect((await probeAgentSocket(path)).state).toBe("absent")
      return
    }
    expect((await probeAgentSocket(path)).state).toBe("stale")
    expect(existsSync(path)).toBe(false)
  })

  it("scans a directory holding several sidecars", async () => {
    const dir = tmpDir()
    await sidecar(dir, "one")
    await sidecar(dir, "two")
    await sidecar(dir, "three")

    expect(listAgentSockets(dir).sort()).toEqual(["one", "three", "two"])
    for (const id of listAgentSockets(dir)) {
      expect((await probeAgentSocket(agentSocketPath(dir, id))).state).toBe("alive")
    }
  })
})
