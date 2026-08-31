import { connect } from "node:net"
import { access } from "node:fs/promises"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { connectUnix, listenUnix } from "./unix-socket.js"
import { createNamedPipeTransport } from "./named-pipe.js"

function sockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "acp-wire-test-"))
  return join(dir, "test.sock")
}

async function waitForSocket(path: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  throw new Error(`socket not ready: ${path}`)
}

/** connect + immediate destroy — same-tick probe contract (socketAlive). */
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

describe("unix-socket", () => {
  it("exchanges bytes bidirectionally", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)
    const client = await connectUnix(path)
    const handle = await listenPromise
    const server = handle.transport

    const enc = new TextEncoder()
    const dec = new TextDecoder()

    const cw = client.writable.getWriter()
    await cw.write(enc.encode("hello\n"))
    cw.releaseLock()

    const sr = server.readable.getReader()
    const { value: serverReceived } = await sr.read()
    sr.releaseLock()
    expect(dec.decode(serverReceived)).toBe("hello\n")

    const sw = server.writable.getWriter()
    await sw.write(enc.encode("world\n"))
    sw.releaseLock()

    const cr = client.readable.getReader()
    const { value: clientReceived } = await cr.read()
    cr.releaseLock()
    expect(dec.decode(clientReceived)).toBe("world\n")

    client.close()
    server.close()
    handle.close()
  })

  it("invokes onClose at most once per transport", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)
    const client = await connectUnix(path)
    const handle = await listenPromise
    const server = handle.transport

    let clientCount = 0
    let serverCount = 0
    client.onClose(() => {
      clientCount++
    })
    server.onClose(() => {
      serverCount++
    })

    server.close()
    await new Promise((r) => setTimeout(r, 50))

    expect(clientCount).toBeLessThanOrEqual(1)
    expect(serverCount).toBeLessThanOrEqual(1)
    client.close()
    handle.close()
  })

  it("second connection replaces first (client-wins)", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)

    const c1 = await connectUnix(path)
    const handle = await listenPromise

    let c1Closed = false
    c1.onClose(() => {
      c1Closed = true
    })

    const c2 = await connectUnix(path)
    await new Promise((r) => setTimeout(r, 50))

    expect(c1Closed).toBe(true)

    const current = handle.current()
    expect(current).toBeDefined()

    const enc = new TextEncoder()
    const dec = new TextDecoder()

    const cw = c2.writable.getWriter()
    await cw.write(enc.encode("from-c2\n"))
    cw.releaseLock()

    const sr = current!.readable.getReader()
    const { value: received } = await sr.read()
    sr.releaseLock()
    expect(dec.decode(received)).toBe("from-c2\n")

    const sw = current!.writable.getWriter()
    await sw.write(enc.encode("to-c2\n"))
    sw.releaseLock()

    const cr = c2.readable.getReader()
    const { value: reply } = await cr.read()
    cr.releaseLock()
    expect(dec.decode(reply)).toBe("to-c2\n")

    c1.close()
    c2.close()
    handle.close()
  })

  it("peer close does not unlink listen", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)
    const client = await connectUnix(path)
    const handle = await listenPromise

    handle.transport.close()
    client.close()

    await access(path)

    const client2 = await connectUnix(path)
    expect(handle.current()).toBeDefined()

    client2.close()
    handle.close()

    await expect(access(path)).rejects.toThrow()
  })

  it("connect+destroy probe does not promote", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)

    await probeConnect(path)

    let resolved = false
    listenPromise.then(() => {
      resolved = true
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(resolved).toBe(false)

    const client = await connectUnix(path)
    const handle = await listenPromise
    expect(handle).toBeDefined()

    const currentBefore = handle.current()
    await probeConnect(path)
    await new Promise((r) => setTimeout(r, 50))
    expect(handle.current()).toBe(currentBefore)

    client.close()
    handle.close()
  })

  it("createNamedPipeTransport throws", () => {
    expect(() => createNamedPipeTransport("\\\\.\\pipe\\test")).toThrow(
      "named-pipe: not verified on Windows",
    )
  })
})
