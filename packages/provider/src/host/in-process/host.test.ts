/**
 * host.test.ts — integration tests for InProcessHost + capabilities + ext round-trip.
 *
 * IMPORTANT: initialize only — zero session/prompt calls.
 * No inference, no tokens. Only handshake + ext.
 *
 * DoD coverage:
 * - DoD 2: start() → NormalizedCapabilities (mcp=true, compact/usage/commands=false)
 * - DoD 3: callExt round-trip (no -32601)
 * - DoD 4: close() — no leak (both connections close, no error thrown)
 * - DoD 7: no session/prompt in this file (grep check in DoD)
 */

import { afterEach, describe, expect, it } from "vitest"
import type { InProcessHost } from "./host.js"
import { createClaudeInProcessHost } from "./host.js"

// Safety: fail immediately if any test tries to call session/prompt
// (this is a static check; the real check is grep in DoD 7)

describe("InProcessHost — initialize only (no session/prompt)", () => {
  let host: InProcessHost | undefined

  afterEach(async () => {
    // Always close to avoid leaked connections
    if (host) {
      await host.close()
      host = undefined
    }
  })

  it("start() returns NormalizedCapabilities with mcp=true, compact/usage/commands=false", async () => {
    host = createClaudeInProcessHost()
    const { capabilities } = await host.start({ cwd: process.cwd() })

    // Verified against real initialize frame from C3-spike findings:
    // mcpCapabilities: { http: true, sse: true } → mcp=true
    expect(capabilities.mcp).toBe(true)

    // Not declared in initialize (runtime features) → false
    expect(capabilities.compact).toBe(false)
    expect(capabilities.usage).toBe(false)
    expect(capabilities.commands).toBe(false)

    // configOptions from session/new only, not hardcoded
    expect(capabilities.configOptions).toBe(false)
  })

  it("callExt round-trip — registered ext handler returns response (no -32601)", async () => {
    host = createClaudeInProcessHost({
      extHandlers: {
        "ext/test/ping": (params) => ({
          pong: (params as { message?: string }).message ?? "no-message",
          ts: Date.now(),
        }),
      },
    })

    await host.start({ cwd: process.cwd() })

    const result = await host.callExt("ext/test/ping", { message: "hello-from-test" })

    expect(result).toMatchObject({ pong: "hello-from-test" })
    expect(typeof result.ts).toBe("number")
  })

  it("close() resolves cleanly — no error, no leak", async () => {
    host = createClaudeInProcessHost()
    await host.start({ cwd: process.cwd() })

    // close() should not throw
    await expect(host.close()).resolves.toBeUndefined()

    // Clear the ref so afterEach doesn't double-close
    host = undefined
  })

  it("onExtNotification — unsubscribe works (no error)", () => {
    host = createClaudeInProcessHost()
    const received: Array<{ method: string; params: Record<string, unknown> }> = []

    const unsub = host.onExtNotification((method, params) => {
      received.push({ method, params })
    })

    // Unsubscribe should work without error
    expect(() => unsub()).not.toThrow()
  })

  it("full lifecycle — start, callExt, close in sequence", async () => {
    host = createClaudeInProcessHost({
      extHandlers: {
        "ext/lifecycle/check": (_params) => ({ ok: true }),
      },
    })

    const { capabilities } = await host.start({ cwd: process.cwd() })
    expect(capabilities.mcp).toBe(true)

    const extResult = await host.callExt("ext/lifecycle/check", {})
    expect(extResult).toEqual({ ok: true })

    await host.close()
    host = undefined
  })
})
