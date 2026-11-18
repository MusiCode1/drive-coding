/**
 * Spawn-level gates for the agent CLI (brief §6: 2, 3, 3b, 4, 8).
 * Isolated XDG_RUNTIME_DIR + mock /api/health listeners. No drive-coding server.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { type InstanceRecord, writeInstance } from "../instances.js"

const bin = fileURLToPath(new URL("../bin/drive-coding.ts", import.meta.url))

type MockServer = { port: number; close: () => Promise<void>; posts: unknown[] }

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

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const posts: unknown[] = []
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        const chunks: Buffer[] = []
        req.on("data", (c: Buffer) => chunks.push(c))
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          try {
            posts.push(JSON.parse(raw))
          } catch {
            posts.push(raw)
          }
          handler(req, res)
        })
        return
      }
      handler(req, res)
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (typeof addr !== "object" || addr === null) {
        reject(new Error("no address"))
        return
      }
      resolve({
        port: addr.port,
        posts,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

function healthAndAgents(): Promise<MockServer> {
  return listen((req, res) => {
    const url = req.url ?? ""
    if (url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ status: "ok", version: "t", uptime: 1, service: "drive-coding" }))
      return
    }
    if (req.method === "GET" && url === "/api/agents") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ agents: [] }))
      return
    }
    if (req.method === "POST" && url === "/api/agents") {
      res.writeHead(201, { "content-type": "application/json" })
      res.end(JSON.stringify({ agentId: "agent-probe" }))
      return
    }
    if (url.includes("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.end()
      return
    }
    if (url.includes("/state")) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({ sessionId: "sess-1", turnState: "idle", modes: null, configOptions: [] }),
      )
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
}

function healthOnly(): Promise<MockServer> {
  return listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ status: "ok", version: "t", uptime: 1, service: "drive-coding" }))
  })
}

const servers: MockServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
})

function run(
  args: string[],
  xdg: string,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_RUNTIME_DIR: xdg }
    delete env.PORT
    delete env.DRIVE_CODING_BASE
    const child = spawn("bun", [bin, ...args], { env })
    let stderr = ""
    let stdout = ""
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    child.on("close", (code) => resolve({ code, stderr, stdout }))
  })
}

describe("§6 spawn gates", () => {
  it("gate 2: agent list --json with one live instance exits 0", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dc-g2-"))
    const s = await healthAndAgents()
    servers.push(s)
    writeInstance(rec(s.port), { XDG_RUNTIME_DIR: xdg })
    const r = await run(["agent", "list", "--json"], xdg)
    expect(r.stderr).not.toMatch(/Unexpected argument|Unknown option/)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/"agents"/)
  })

  it("gate 3: two live instances → agent list without --port exits != 0 and prints both", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dc-g3-"))
    const a = await healthOnly()
    const b = await healthOnly()
    servers.push(a, b)
    writeInstance(rec(a.port), { XDG_RUNTIME_DIR: xdg })
    writeInstance(rec(b.port), { XDG_RUNTIME_DIR: xdg })
    const r = await run(["agent", "list"], xdg)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(String(a.port))
    expect(r.stderr).toMatch(String(b.port))
  })

  it("gate 3b: empty dir → agent list != 0, instances exit 0 with empty json", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dc-g3b-"))
    const list = await run(["agent", "list"], xdg)
    expect(list.code).not.toBe(0)
    const inst = await run(["instances", "--json"], xdg)
    expect(inst.code).toBe(0)
    expect(JSON.parse(inst.stdout)).toEqual({ instances: [] })
  })

  it("gate 4: dead 9999.json is pruned from instances and deleted", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dc-g4-"))
    const file = writeInstance(rec(9999), { XDG_RUNTIME_DIR: xdg })
    writeFileSync(file, JSON.stringify(rec(9999)))
    const r = await run(["instances", "--json"], xdg)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ instances: [] })
    expect(existsSync(file)).toBe(false)
  })

  it("gate 8: agent open injects DRIVE_CODING_BASE and DC_BASE", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dc-g8-"))
    const s = await healthAndAgents()
    servers.push(s)
    writeInstance(rec(s.port), { XDG_RUNTIME_DIR: xdg })
    const r = await run(
      ["agent", "open", "--cli", "cursor", "--cwd", "/tmp", "--env", "DC_PROBE=nonce", "--json"],
      xdg,
    )
    expect(r.code).toBe(0)
    const post = s.posts[0] as { env?: Record<string, string> }
    expect(post.env?.DRIVE_CODING_BASE).toBe(`http://127.0.0.1:${s.port}`)
    expect(post.env?.DC_BASE).toBe(`http://127.0.0.1:${s.port}`)
    expect(post.env?.DC_PROBE).toBe("nonce")
  })

  it("gate 3: agent open --system-prompt forwards charter in POST body", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dc-g3-charter-"))
    const s = await healthAndAgents()
    servers.push(s)
    writeInstance(rec(s.port), { XDG_RUNTIME_DIR: xdg })
    const r = await run(
      [
        "agent",
        "open",
        "--cli",
        "cursor",
        "--cwd",
        "/tmp",
        "--system-prompt",
        "CHARTER_X",
        "--json",
      ],
      xdg,
    )
    expect(r.code).toBe(0)
    const post = s.posts[0] as { systemPrompt?: string }
    expect(post.systemPrompt).toBe("CHARTER_X")
  })

  it("gate 3: agent open --role-label forwards roleLabel in POST body", async () => {
    const xdg = mkdtempSync(join(tmpdir(), "dc-g3-role-label-"))
    const s = await healthAndAgents()
    servers.push(s)
    writeInstance(rec(s.port), { XDG_RUNTIME_DIR: xdg })
    const r = await run(
      [
        "agent",
        "open",
        "--cli",
        "cursor",
        "--cwd",
        "/tmp",
        "--role-label",
        "executor",
        "--json",
      ],
      xdg,
    )
    expect(r.code).toBe(0)
    const post = s.posts[0] as { roleLabel?: string }
    expect(post.roleLabel).toBe("executor")
  })
})
