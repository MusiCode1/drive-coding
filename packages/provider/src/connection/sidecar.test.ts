/**
 * sidecar.test.ts — connectSidecar against a real listening socket.
 *
 * The socket is genuine (`listenUnix`), because the parts most likely to be
 * wrong are the ones a mock would paper over: line reassembly across chunk
 * boundaries, and what `close()` does to the other end.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listenUnix, type UnixListenHandle } from "@drive-coding/acp-wire/node"
import { afterEach, describe, expect, it } from "vitest"
import { connectSidecar } from "./sidecar.js"

const dirs: string[] = []
const handles: UnixListenHandle[] = []
const enc = new TextEncoder()

async function listener(): Promise<{ path: string; handle: UnixListenHandle }> {
  const dir = mkdtempSync(join(tmpdir(), "sidecar-conn-"))
  dirs.push(dir)
  const path = join(dir, "a.sock")
  const handle = await listenUnix(path)
  handles.push(handle)
  return { path, handle }
}

/** Push a raw string from the sidecar side to whoever owns the socket. */
async function fromSidecar(handle: UnixListenHandle, text: string): Promise<void> {
  const peer = handle.current()
  if (peer === undefined) throw new Error("no peer attached")
  const w = peer.writable.getWriter()
  await w.write(enc.encode(text))
  w.releaseLock()
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  for (const h of handles) h.close()
  handles.length = 0
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe("connectSidecar", () => {
  it("writes reach the sidecar and promote us to owner", async () => {
    const { path, handle } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })

    conn.wire.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`)
    const peer = await handle.accepted()

    const r = peer.readable.getReader()
    const { value } = await r.read()
    r.releaseLock()
    expect(new TextDecoder().decode(value)).toContain("initialize")
    await conn.close()
  })

  it("delivers lines from the sidecar to onLine subscribers", async () => {
    const { path, handle } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    const lines: string[] = []
    conn.wire.onLine((l) => lines.push(l))

    conn.wire.write("hello\n")
    await handle.accepted()
    await fromSidecar(handle, `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n`)
    await settle()

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toEqual({ jsonrpc: "2.0", id: 1, result: {} })
    await conn.close()
  })

  it("🔴 reassembles a frame split across chunks", async () => {
    // A large session/update routinely lands in several reads. Splitting per
    // chunk instead of per newline would corrupt most of them.
    const { path, handle } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    const lines: string[] = []
    conn.wire.onLine((l) => lines.push(l))

    conn.wire.write("x\n")
    await handle.accepted()

    const payload = JSON.stringify({ jsonrpc: "2.0", id: 9, result: { text: "z".repeat(500) } })
    await fromSidecar(handle, payload.slice(0, 40))
    await settle(20)
    expect(lines).toHaveLength(0)
    await fromSidecar(handle, `${payload.slice(40)}\n`)
    await settle()

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).result.text).toHaveLength(500)
    await conn.close()
  })

  it("splits two frames arriving in one chunk", async () => {
    const { path, handle } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    const lines: string[] = []
    conn.wire.onLine((l) => lines.push(l))

    conn.wire.write("x\n")
    await handle.accepted()
    await fromSidecar(handle, '{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","id":2}\n')
    await settle()

    expect(lines.map((l) => JSON.parse(l).id)).toEqual([1, 2])
    await conn.close()
  })

  it("decodes frames and tracks the turn", async () => {
    const { path, handle } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    const frames: string[] = []
    conn.onFrame((f) => frames.push(`${f.dir}:${f.type}`))

    conn.wire.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/prompt" })}\n`)
    await handle.accepted()
    await fromSidecar(
      handle,
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk" } },
      })}\n`,
    )
    await settle()

    expect(frames).toContain("out:session/prompt")
    expect(frames.some((f) => f.startsWith("in:"))).toBe(true)
    expect(conn.turn.lastActivityAt()).not.toBeNull()
    await conn.close()
  })

  it("🔴 pid is the sidecar's, and it is null when unknown", async () => {
    // Naming it explicitly because the obvious reading — "the agent's pid" — is
    // wrong, and a caller who signalled it would hit the wrong process.
    const { path } = await listener()
    const withPid = await connectSidecar({ socketPath: path, cliKind: "cursor", sidecarPid: 4242 })
    expect(withPid.pid).toBe(4242)
    await withPid.close()

    const without = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    expect(without.pid).toBeNull()
    await without.close()
  })

  it("🔴 close() disconnects and leaves the listener standing", async () => {
    // If close() killed the sidecar, the backend's own shutdown — which closes
    // every connection — would still take every agent down with it.
    const { path, handle } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    conn.wire.write("own\n")
    await handle.accepted()

    await conn.close()
    await settle()

    // The door is still open: a fresh connection attaches to the same sidecar.
    const again = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    again.wire.write("again\n")
    const peer2 = await handle.accepted()
    expect(peer2).toBeDefined()
    await again.close()
  })

  it("reports loss when the sidecar goes away", async () => {
    const { path, handle } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    conn.wire.write("own\n")
    await handle.accepted()

    let crash: unknown = null
    conn.onCrash((info) => {
      crash = info
    })

    handle.close()
    await settle(150)

    expect(crash).toEqual({ exitCode: null, signal: null })
    expect(conn.wire.write("after\n")).toBe(false)
  })

  it("exposes static capabilities for the cliKind", async () => {
    const { path } = await listener()
    const conn = await connectSidecar({ socketPath: path, cliKind: "cursor" })
    expect(conn.capabilities).toBeDefined()
    expect(conn.ext).toBeUndefined()
    await conn.close()
  })
})
