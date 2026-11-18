import { mkdtempSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { type InstanceRecord, writeInstance } from "../instances.js"
import { childEnv, resolveBase } from "./discover.js"

type MockServer = { port: number; close: () => Promise<void> }
const servers: MockServer[] = []

function jsonHealth(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ status: "ok", version: "t", uptime: 1, service: "drive-coding" }))
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (typeof addr !== "object" || addr === null) {
        reject(new Error("no address"))
        return
      }
      const mock = {
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      }
      servers.push(mock)
      resolve(mock)
    })
  })
}

function rec(port: number): InstanceRecord {
  return {
    port,
    host: "127.0.0.1",
    pid: 1,
    version: "t",
    cwd: "/tmp",
    https: false,
    startedAt: 1,
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
})

function freshEnv(): NodeJS.ProcessEnv {
  return { XDG_RUNTIME_DIR: mkdtempSync(join(tmpdir(), "dc-discover-")) }
}

describe("resolveBase", () => {
  it("--base wins over everything", async () => {
    const env = freshEnv()
    const r = await resolveBase({
      base: "http://example.invalid:9",
      port: "1",
      env: { ...env, DRIVE_CODING_BASE: "http://nope" },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.base).toBe("http://example.invalid:9")
  })

  it("zero live instances → none", async () => {
    const r = await resolveBase({ env: freshEnv() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe("none")
  })

  it("one live instance → connect", async () => {
    const env = freshEnv()
    const s = await jsonHealth()
    writeInstance(rec(s.port), env)
    const r = await resolveBase({ env })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.base).toBe(`http://127.0.0.1:${s.port}`)
  })

  it("two live instances → ambiguous, and PORT env does not pick one", async () => {
    const env = freshEnv()
    const a = await jsonHealth()
    const b = await jsonHealth()
    writeInstance(rec(a.port), env)
    writeInstance(rec(b.port), env)
    const r = await resolveBase({ env: { ...env, PORT: String(a.port) } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.kind).toBe("ambiguous")
      expect(r.instances.map((i) => i.port).sort((x, y) => x - y)).toEqual(
        [a.port, b.port].sort((x, y) => x - y),
      )
    }
  })
})

describe("childEnv", () => {
  it("injects both DRIVE_CODING_BASE and DC_BASE", () => {
    const env2 = childEnv("http://127.0.0.1:4001", { DC_PROBE: "n" }, "parent-1")
    expect(env2.DRIVE_CODING_BASE).toBe("http://127.0.0.1:4001")
    expect(env2.DC_BASE).toBe("http://127.0.0.1:4001")
    expect(env2.DC_PARENT).toBe("parent-1")
    expect(env2.DC_PROBE).toBe("n")
  })
})
