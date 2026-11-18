/**
 * instances.test.ts — instance registry: XDG dir, write, live prune via /api/health.
 *
 * Approach: TDD / integration — real mock HTTP listeners, isolated XDG_RUNTIME_DIR.
 */

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerHttp } from "./delivery/http.js"
import { httpCacheInvalidateAll } from "./delivery/http-cache.js"
import {
  getInstancesDir,
  type InstanceRecord,
  isDriveCodingHealth,
  removeInstance,
  resolveInstances,
  writeInstance,
} from "./instances.js"
import { getStateDir } from "./paths.js"

type MockServer = { port: number; close: () => Promise<void> }

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler)
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (typeof addr !== "object" || addr === null) {
        reject(new Error("listen: no address"))
        return
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise((r) => {
            server.close(() => r())
          }),
      })
    })
  })
}

function jsonHealth(body: unknown, status = 200): Promise<MockServer> {
  return listen((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
}

function record(port: number, extra?: Partial<InstanceRecord>): InstanceRecord {
  return {
    port,
    host: "127.0.0.1",
    pid: process.pid,
    version: "0.17.0",
    cwd: "/tmp",
    https: false,
    startedAt: Date.now(),
    ...extra,
  }
}

const servers: MockServer[] = []
const xdg = mkdtempSync(join(tmpdir(), "dc-instances-"))
const env: NodeJS.ProcessEnv = { XDG_RUNTIME_DIR: xdg }

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  const dir = getInstancesDir(env)
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json")) removeInstance(Number(name.replace(/\.json$/, "")), env)
    }
  } catch {
    // dir may not exist yet
  }
})

describe("GET /api/health", () => {
  beforeEach(() => {
    httpCacheInvalidateAll()
  })

  it("advertises additive service=drive-coding", async () => {
    const app = new Hono()
    registerHttp(app)
    const res = await app.request("/api/health")
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.service).toBe("drive-coding")
    expect(typeof body.status).toBe("string")
    expect(typeof body.version).toBe("string")
    expect(typeof body.uptime).toBe("number")
  })
})

describe("getInstancesDir", () => {
  it("uses $XDG_RUNTIME_DIR/drive-coding when set", () => {
    expect(getInstancesDir({ XDG_RUNTIME_DIR: "/run/user/1001" })).toBe(
      "/run/user/1001/drive-coding",
    )
  })

  it("falls back to stateDir/instances when XDG_RUNTIME_DIR is unset", () => {
    expect(getInstancesDir({})).toBe(join(getStateDir(), "instances"))
  })
})

describe("isDriveCodingHealth", () => {
  it("accepts additive service=drive-coding", () => {
    expect(isDriveCodingHealth({ service: "drive-coding", status: "ok" })).toBe(true)
  })

  it("falls back to {status,version,uptime} shape for old servers", () => {
    expect(isDriveCodingHealth({ status: "ok", version: "0.17.0", uptime: 1.2 })).toBe(true)
  })

  it("rejects a typical foreign occupant (no version, no service)", () => {
    expect(isDriveCodingHealth({ status: "ok" })).toBe(false)
    expect(isDriveCodingHealth("not json object")).toBe(false)
  })
})

describe("writeInstance / removeInstance", () => {
  it("writes <port>.json under the XDG dir", () => {
    const rec = record(4123)
    const file = writeInstance(rec, env)
    expect(file).toBe(join(xdg, "drive-coding", "4123.json"))
    const parsed = JSON.parse(readFileSync(file, "utf8")) as InstanceRecord
    expect(parsed.port).toBe(4123)
    expect(parsed.host).toBe("127.0.0.1")
    removeInstance(4123, env)
    expect(() => readFileSync(file, "utf8")).toThrow()
  })
})

describe("resolveInstances", () => {
  it("returns a live instance whose /api/health has service=drive-coding", async () => {
    const srv = await jsonHealth({
      status: "ok",
      version: "0.99.0",
      uptime: 1,
      service: "drive-coding",
    })
    servers.push(srv)
    writeInstance(record(srv.port), env)
    const live = await resolveInstances(env)
    expect(live).toHaveLength(1)
    expect(live[0]?.port).toBe(srv.port)
  })

  it("keeps an old server that only has the shape fallback", async () => {
    const srv = await jsonHealth({ status: "ok", version: "0.17.0", uptime: 12 })
    servers.push(srv)
    writeInstance(record(srv.port), env)
    const live = await resolveInstances(env)
    expect(live.map((r) => r.port)).toEqual([srv.port])
  })

  it("returns both when two live records exist (ambiguity is the caller's problem)", async () => {
    const a = await jsonHealth({
      status: "ok",
      version: "a",
      uptime: 1,
      service: "drive-coding",
    })
    const b = await jsonHealth({
      status: "ok",
      version: "b",
      uptime: 1,
      service: "drive-coding",
    })
    servers.push(a, b)
    writeInstance(record(a.port), env)
    writeInstance(record(b.port), env)
    const live = await resolveInstances(env)
    expect(live.map((r) => r.port).sort((x, y) => x - y)).toEqual(
      [a.port, b.port].sort((x, y) => x - y),
    )
  })

  it("prunes a dead record: no listener → not listed and file deleted", async () => {
    const deadPort = 9999
    const file = writeInstance(record(deadPort), env)
    writeFileSync(file, JSON.stringify(record(deadPort)), "utf8")
    const live = await resolveInstances(env)
    expect(live).toEqual([])
    expect(() => readFileSync(file, "utf8")).toThrow()
  })

  it("prunes a foreign occupant that returns 404 on /api/health", async () => {
    const srv = await jsonHealth({ error: "nope" }, 404)
    servers.push(srv)
    const file = writeInstance(record(srv.port), env)
    const live = await resolveInstances(env)
    expect(live).toEqual([])
    expect(() => readFileSync(file, "utf8")).toThrow()
  })

  it("empty directory → empty list, exit-path of instances stays 0 at the CLI layer", async () => {
    const live = await resolveInstances(env)
    expect(live).toEqual([])
  })
})
