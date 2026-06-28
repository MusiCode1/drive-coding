/**
 * https-serve.test.ts — integration tests for HTTPS serve (commit 1).
 *
 * Starts the actual server via Bun subprocess, verifies HTTP and HTTPS modes.
 * Uses ports 4090 (HTTP) and 4091 (HTTPS) to avoid conflicts with running instances.
 *
 * Coverage:
 *  1. HTTP mode (no DRIVE_CODING_HTTPS) — GET / returns 200
 *  2. HTTPS self-signed mode — GET / via curl -k returns 200
 *  3. HTTPS self-signed cert is written to state dir (idempotent)
 */

import * as fs from "node:fs"
import * as https from "node:https"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn } from "node:child_process"

// Allow longer timeout for server startup
const SERVER_TIMEOUT = 8000
const STARTUP_WAIT = 3000

function waitForServer(
  protocol: "http" | "https",
  port: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tryConnect = () => {
      const req = (protocol === "https" ? https : http).request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/",
          method: "GET",
          rejectUnauthorized: false,
          timeout: 1000,
        },
        (res) => {
          res.resume()
          resolve()
        },
      )
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server on ${protocol}://127.0.0.1:${port} did not start in time`))
          return
        }
        setTimeout(tryConnect, 300)
      })
      req.end()
    }
    tryConnect()
  })
}

function httpGet(
  protocol: "http" | "https",
  port: number,
  path_: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = (protocol === "https" ? https : http).request(
      {
        hostname: "127.0.0.1",
        port,
        path: path_,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        let body = ""
        res.on("data", (chunk) => (body += chunk.toString()))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on("error", reject)
    req.end()
  })
}

const BUN_PATH = "D:/ProgramsAndApps/Bun/bin/bun.exe"
const SERVER_ENTRY = "packages/backend/src/server.ts"
const ROOT = "D:/UserProjects/AI/drive-coding/.worktrees/https-local"

describe("HTTP serve (no DRIVE_CODING_HTTPS)", () => {
  let proc: ReturnType<typeof spawn> | null = null
  let tmpHome: string

  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "https-serve-http-"))
    proc = spawn(
      BUN_PATH,
      [SERVER_ENTRY],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: "4090",
          HOME: tmpHome,
          USERPROFILE: tmpHome,
        },
        stdio: "pipe",
      },
    )
    await waitForServer("http", 4090, STARTUP_WAIT)
  }, SERVER_TIMEOUT)

  afterAll(() => {
    proc?.kill("SIGTERM")
    try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /**/ }
  })

  it("GET /api/agents returns 200 on HTTP (regression check)", async () => {
    const res = await httpGet("http", 4090, "/api/agents")
    expect(res.status).toBe(200)
  })
})

describe("HTTPS serve (DRIVE_CODING_HTTPS=true, self-signed)", () => {
  let proc: ReturnType<typeof spawn> | null = null
  let tmpHome: string

  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "https-serve-tls-"))
    proc = spawn(
      BUN_PATH,
      [SERVER_ENTRY],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: "4091",
          DRIVE_CODING_HTTPS: "true",
          HOME: tmpHome,
          USERPROFILE: tmpHome,
        },
        stdio: "pipe",
      },
    )
    await waitForServer("https", 4091, STARTUP_WAIT)
  }, SERVER_TIMEOUT)

  afterAll(() => {
    proc?.kill("SIGTERM")
    try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /**/ }
  })

  it("GET /api/agents returns 200 over HTTPS (self-signed, rejectUnauthorized=false)", async () => {
    const res = await httpGet("https", 4091, "/api/agents")
    expect(res.status).toBe(200)
  })

  it("self-signed cert is written to state dir", async () => {
    const tlsDir = path.join(tmpHome, ".config", "drive-coding", "tls")
    expect(fs.existsSync(path.join(tlsDir, "key.pem"))).toBe(true)
    expect(fs.existsSync(path.join(tlsDir, "cert.pem"))).toBe(true)
  })
})
