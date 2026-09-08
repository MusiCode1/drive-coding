import { mkdtempSync } from "node:fs"
import { access } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { encodePing } from "../control/ping.js"
import { createNamedPipeTransport } from "./named-pipe.js"
import type { AcpTransport } from "./types.js"
import { connectUnix, listenUnix } from "./unix-socket.js"

const enc = new TextEncoder()
const dec = new TextDecoder()

function sockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "acp-wire-test-"))
  return join(dir, "test.sock")
}

async function write(t: AcpTransport, text: string): Promise<void> {
  const w = t.writable.getWriter()
  await w.write(enc.encode(text))
  w.releaseLock()
}

async function readOne(t: AcpTransport): Promise<string> {
  const r = t.readable.getReader()
  const { value } = await r.read()
  r.releaseLock()
  return dec.decode(value)
}

/** connect + immediate destroy — the legacy socketAlive contract. */
function probeConnect(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = connect(path)
    sock.once("connect", () => {
      sock.destroy()
      resolve()
    })
    sock.once("error", reject)
  })
}

/** Send one `_drive/ping` and resolve with the raw answer line. */
function pingOnce(path: string, id: string | number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(path)
    sock.once("connect", () => sock.write(encodePing(id)))
    sock.once("data", (b: Buffer) => {
      resolve(b.toString("utf8"))
      sock.destroy()
    })
    sock.once("error", reject)
  })
}

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe("unix-socket", () => {
  it("resolves as soon as it is bound, before any client exists", async () => {
    const path = sockPath()
    const handle = await listenUnix(path)
    await access(path)
    expect(handle.current()).toBeUndefined()
    handle.close()
  })

  it("exchanges bytes bidirectionally", async () => {
    const path = sockPath()
    const handle = await listenUnix(path)
    const client = await connectUnix(path)

    await write(client, "hello\n")
    const server = await handle.accepted()
    expect(await readOne(server)).toBe("hello\n")

    await write(server, "world\n")
    expect(await readOne(client)).toBe("world\n")

    client.close()
    server.close()
    handle.close()
  })

  it("🔴 replays the opening frame instead of swallowing it", async () => {
    // The peek that classifies the connection consumes the peer's first line.
    // Without the prelude, every connection would lose its `initialize`.
    const path = sockPath()
    const handle = await listenUnix(path)
    const client = await connectUnix(path)

    const opening = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`
    await write(client, opening)

    const server = await handle.accepted()
    expect(await readOne(server)).toBe(opening)

    client.close()
    handle.close()
  })

  it("invokes onClose at most once per transport", async () => {
    const path = sockPath()
    const handle = await listenUnix(path)
    const client = await connectUnix(path)
    await write(client, "hi\n")
    const server = await handle.accepted()

    let clientCount = 0
    let serverCount = 0
    client.onClose(() => {
      clientCount++
    })
    server.onClose(() => {
      serverCount++
    })

    server.close()
    await settle()

    expect(clientCount).toBeLessThanOrEqual(1)
    expect(serverCount).toBeLessThanOrEqual(1)
    client.close()
    handle.close()
  })

  it("second connection replaces first (client-wins)", async () => {
    const path = sockPath()
    const handle = await listenUnix(path)

    const c1 = await connectUnix(path)
    await write(c1, "from-c1\n")
    await handle.accepted()

    let c1Closed = false
    c1.onClose(() => {
      c1Closed = true
    })

    const c2 = await connectUnix(path)
    await write(c2, "from-c2\n")
    await settle()

    expect(c1Closed).toBe(true)
    const current = handle.current()
    expect(current).toBeDefined()
    expect(await readOne(current!)).toBe("from-c2\n")

    await write(current!, "to-c2\n")
    expect(await readOne(c2)).toBe("to-c2\n")

    c1.close()
    c2.close()
    handle.close()
  })

  it("peer close does not unlink listen", async () => {
    const path = sockPath()
    const handle = await listenUnix(path)
    const client = await connectUnix(path)
    await write(client, "a\n")
    const server = await handle.accepted()

    server.close()
    client.close()
    await access(path)

    const client2 = await connectUnix(path)
    await write(client2, "b\n")
    await settle()
    expect(handle.current()).toBeDefined()

    client2.close()
    handle.close()

    await expect(access(path)).rejects.toThrow()
  })

  it("connect+destroy probe does not promote", async () => {
    const path = sockPath()
    const handle = await listenUnix(path)

    await probeConnect(path)
    await settle()
    expect(handle.current()).toBeUndefined()

    const client = await connectUnix(path)
    await write(client, "real\n")
    const owner = await handle.accepted()

    await probeConnect(path)
    await settle()
    expect(handle.current()).toBe(owner)

    client.close()
    handle.close()
  })

  describe("_drive/ping", () => {
    it("answers a ping without a peer ever being promoted", async () => {
      const path = sockPath()
      const handle = await listenUnix(path)

      const answer = JSON.parse(await pingOnce(path, 1))
      expect(answer).toEqual({ jsonrpc: "2.0", id: 1, result: { alive: true } })
      expect(handle.current()).toBeUndefined()

      handle.close()
    })

    it("🔴 does not evict the live owner", async () => {
      // The case the old timing heuristic could not survive: a probe that
      // speaks. Before this change it was promoted first and answered second.
      const path = sockPath()
      const handle = await listenUnix(path)

      const client = await connectUnix(path)
      await write(client, "own-it\n")
      const owner = await handle.accepted()

      let ownerClosed = false
      owner.onClose(() => {
        ownerClosed = true
      })

      for (const id of [1, 2, 3]) {
        const answer = JSON.parse(await pingOnce(path, id))
        expect(answer.result).toEqual({ alive: true })
      }
      await settle()

      expect(ownerClosed).toBe(false)
      expect(handle.current()).toBe(owner)

      // …and the session is still usable after all that probing.
      await write(owner, "still-here\n")
      expect(await readOne(client)).toBe("still-here\n")

      client.close()
      handle.close()
    })

    it("carries the identity the host supplies", async () => {
      const path = sockPath()
      const handle = await listenUnix(path)
      handle.onPing(() => ({ agentId: "abc", cliKind: "cursor", pid: 123 }))

      const answer = JSON.parse(await pingOnce(path, "x"))
      expect(answer.result).toEqual({
        alive: true,
        info: { agentId: "abc", cliKind: "cursor", pid: 123 },
      })

      handle.close()
    })

    it("a ping arriving in two chunks is still recognised", async () => {
      const path = sockPath()
      const handle = await listenUnix(path)
      const line = encodePing(5)

      const answer = await new Promise<string>((resolve, reject) => {
        const sock = connect(path)
        sock.once("connect", () => {
          sock.write(line.slice(0, 10))
          setTimeout(() => sock.write(line.slice(10)), 20)
        })
        sock.once("data", (b: Buffer) => {
          resolve(b.toString("utf8"))
          sock.destroy()
        })
        sock.once("error", reject)
      })

      expect(JSON.parse(answer).result).toEqual({ alive: true })
      expect(handle.current()).toBeUndefined()
      handle.close()
    })
  })

  it("createNamedPipeTransport throws", () => {
    expect(() => createNamedPipeTransport("\\\\.\\pipe\\test")).toThrow(
      "named-pipe: not verified on Windows",
    )
  })
})
