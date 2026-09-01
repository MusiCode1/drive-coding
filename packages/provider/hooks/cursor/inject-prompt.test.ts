/**
 * inject-prompt.test.ts — contract of the Cursor surface-injection hook.
 *
 * The hook is wired in the user's `~/.cursor/hooks.json` and runs on every
 * Cursor session, so its contract is production behaviour — but it had no test
 * until 2026-09-01 (see docs decision `2026-09-01-cursor-hooks-inject-prompt`).
 *
 * Why these cases: the hook is deliberately **fail-open** — any miss exits 0
 * with empty stdout. That makes a broken hook look exactly like "nothing to
 * inject", so the silent paths need pinning at least as much as the happy one.
 *
 * Hermetic: a local http server on an ephemeral port stands in for the BE.
 */

import { spawn, spawnSync } from "node:child_process"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, "inject-prompt.sh")

const hasJq = spawnSync("jq", ["--version"]).status === 0

type Reply = { status: number; contentType: string; body: string }
let reply: Reply = { status: 200, contentType: "text/plain; charset=utf-8", body: "SURFACE_BODY" }

let server: Server
let base = ""

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(reply.status, { "content-type": reply.contentType })
    res.end(reply.body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function runHook(opts: {
  stdin?: string
  argv?: string[]
  env?: Record<string, string | undefined>
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [SCRIPT, ...(opts.argv ?? [])], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DRIVE_CODING_AGENT_ID: "11111111-2222-3333-4444-555555555555",
        DRIVE_CODING_BASE: base,
        // The shared fetch defaults to a 0.4s hard cap; give the local server
        // headroom so a loaded CI box does not read as "BE down".
        DRIVE_CODING_PROMPT_TIMEOUT_S: "5",
        ...opts.env,
      } as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += String(d)))
    child.stderr.on("data", (d) => (stderr += String(d)))
    child.stdin.end(opts.stdin ?? "")
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

describe.skipIf(!hasJq)("cursor inject-prompt hook", () => {
  it("sessionStart → additional_context with the fetched body", async () => {
    reply = { status: 200, contentType: "text/plain; charset=utf-8", body: "SURFACE_BODY" }
    const r = await runHook({ stdin: JSON.stringify({ hook_event_name: "sessionStart" }) })
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ additional_context: "SURFACE_BODY" })
  })

  it("stop → followup_message (branch exists; wiring it is forbidden by the header)", async () => {
    reply = { status: 200, contentType: "text/plain; charset=utf-8", body: "SURFACE_BODY" }
    const r = await runHook({ stdin: JSON.stringify({ hook_event_name: "stop" }) })
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ followup_message: "SURFACE_BODY" })
  })

  it("unknown event falls back to additional_context", async () => {
    const r = await runHook({ stdin: JSON.stringify({ hook_event_name: "somethingElse" }) })
    expect(JSON.parse(r.stdout)).toEqual({ additional_context: "SURFACE_BODY" })
  })

  // ⚠️ Pins CURRENT behaviour, which is the wrong way round: argv beats the
  // real event from stdin. Tracked as BACKLOG #99 — when that flips, this
  // expectation must flip with it, deliberately.
  it("argv currently OVERRIDES hook_event_name from stdin (BACKLOG #99)", async () => {
    const r = await runHook({
      stdin: JSON.stringify({ hook_event_name: "stop" }),
      argv: ["sessionStart"],
    })
    expect(JSON.parse(r.stdout)).toEqual({ additional_context: "SURFACE_BODY" })
  })

  describe("fail-open — every miss is exit 0 with empty stdout", () => {
    it("no agent id", async () => {
      const r = await runHook({
        stdin: JSON.stringify({ hook_event_name: "sessionStart" }),
        env: { DRIVE_CODING_AGENT_ID: undefined },
      })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe("")
    })

    it("backend unreachable", async () => {
      const r = await runHook({
        stdin: JSON.stringify({ hook_event_name: "sessionStart" }),
        env: { DRIVE_CODING_BASE: "http://127.0.0.1:1", DRIVE_CODING_PROMPT_TIMEOUT_S: "1" },
      })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe("")
    })

    it("non-2xx", async () => {
      reply = { status: 500, contentType: "text/plain", body: "boom" }
      const r = await runHook({ stdin: JSON.stringify({ hook_event_name: "sessionStart" }) })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe("")
    })

    it("wrong content-type (FE SPA fallback)", async () => {
      reply = { status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }
      const r = await runHook({ stdin: JSON.stringify({ hook_event_name: "sessionStart" }) })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe("")
    })

    it("empty body", async () => {
      reply = { status: 200, contentType: "text/plain", body: "" }
      const r = await runHook({ stdin: JSON.stringify({ hook_event_name: "sessionStart" }) })
      expect(r.code).toBe(0)
      expect(r.stdout).toBe("")
    })
  })
})
