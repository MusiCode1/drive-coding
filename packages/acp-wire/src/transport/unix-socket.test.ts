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

describe("unix-socket", () => {
  it("exchanges bytes bidirectionally", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)
    const client = await connectUnix(path)
    const server = await listenPromise

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
  })

  it("invokes onClose at most once per transport", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)
    const client = await connectUnix(path)
    const server = await listenPromise

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
  })

  it("destroys second connection (no queue)", async () => {
    const path = sockPath()
    const listenPromise = listenUnix(path)
    await waitForSocket(path)
    const first = await connectUnix(path)
    await listenPromise

    let secondDestroyed = false
    await new Promise<void>((resolve, reject) => {
      const sock = connect(path)
      sock.once("connect", () => {
        sock.on("close", () => {
          secondDestroyed = true
          resolve()
        })
      })
      sock.once("error", reject)
      setTimeout(() => {
        if (!secondDestroyed) {
          sock.destroy()
          resolve()
        }
      }, 200)
    })

    expect(secondDestroyed).toBe(true)
    first.close()
  })

  it("createNamedPipeTransport throws", () => {
    expect(() => createNamedPipeTransport("\\\\.\\pipe\\test")).toThrow(
      "named-pipe: not verified on Windows",
    )
  })
})
