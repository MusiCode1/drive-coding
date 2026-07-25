/**
 * url-upgrade-survival.test.ts — integration test (Commit 2 / be-crash-hardening).
 *
 * Verifies: a malformed HTTP upgrade request (bad request-target like "//[::1")
 * does NOT crash the BE server. The server must survive and continue serving /api/health.
 *
 * Approach:
 *   1. Start a real HTTP server via serve() on a random port.
 *   2. Send a raw HTTP upgrade request with a malformed URL (raw TCP socket write).
 *   3. Wait briefly for the socket to be destroyed.
 *   4. Send a normal GET /api/health — must return 200.
 *
 * Note: If the raw-socket approach is flaky in CI, the test is marked it.skip
 * (per brief §3 / §5) — the unit test of safeUrlPathname is the hard requirement.
 */

import * as http from "node:http"
import * as net from "node:net"
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import type { ServerType } from "@hono/node-server"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { safeUrlPathname } from "../src/delivery/url-safe.js"

// ─── helpers ──────────────────────────────────────────────────────────────────

let server: ServerType | null = null

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
})

/** Start a minimal server with an upgrade handler that uses safeUrlPathname. */
function startTestServer(): Promise<number> {
  return new Promise((resolve) => {
    const app = new Hono()
    app.get("/api/health", (c) => c.json({ ok: true }))

    server = serve({ fetch: app.fetch, port: 0 })

    // Mirror server.ts upgrade handler (with safeUrlPathname guard).
    const wss = new WebSocketServer({ noServer: true })
    wss.on("error", () => {
      /* suppress wss errors in test */
    })

    server.on("upgrade", (req, socket, head) => {
      const pathname = safeUrlPathname(req.url)
      if (pathname === null) {
        socket.destroy()
        return
      }
      if (pathname === "/ws/echo") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req)
        })
        return
      }
      socket.destroy()
    })

    server.on("listening", () => {
      const addr = server!.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve(port)
    })
  })
}

/** GET /api/health via http.get — resolves with status code. */
function httpHealth(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on("error", reject)
  })
}

/** Send a raw malformed HTTP upgrade request over a plain TCP socket. */
function sendMalformedUpgrade(port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "localhost" }, () => {
      // Malformed request-target: "//[::1" — makes new URL() throw TypeError.
      socket.write(
        "GET //[::1 HTTP/1.1\r\n" +
          "Host: localhost\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      )
    })
    socket.on("error", () => resolve())
    socket.on("close", () => resolve())
    // Resolve after a brief delay even if socket stays open (server may not respond).
    setTimeout(() => {
      socket.destroy()
      resolve()
    }, 200)
  })
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("upgrade handler — malformed request-target survival (Commit 2)", () => {
  it(
    "BE survives a malformed upgrade request and continues to serve /api/health",
    async () => {
      const port = await startTestServer()

      // Confirm server is up.
      expect(await httpHealth(port)).toBe(200)

      // Send the malformed upgrade request (the crash vector before the fix).
      await sendMalformedUpgrade(port)

      // Give the server a moment to process.
      await new Promise((r) => setTimeout(r, 100))

      // Server must still be alive and serving /api/health.
      expect(await httpHealth(port)).toBe(200)
    },
    10000,
  )
})
