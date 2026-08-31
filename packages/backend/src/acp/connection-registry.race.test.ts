/**
 * connection-registry.race.test.ts — deterministic race tests for #7
 * (DELETE-during-spawn → immortal child) + double-connect guard.
 *
 * Testing: unit (mocked) — SEPARATE file from connection-registry.test.ts.
 *
 * Why a separate file (brief §4 Commit 1, אביגיל #1):
 * connection-registry.test.ts spawns REAL children (OPENCODE_BIN override) and
 * does NOT use vi.mock — a real child resolves connectSpawn fast and can't be
 * held mid-await deterministically. The race-test needs a connect() that we
 * control the resolution timing of, which requires mocking
 * "@drive-coding/provider/connection". vi.mock is hoisted module-wide, so
 * putting it in the existing file would break the live-child tests there.
 * Hence: isolated in this file.
 *
 * The mock factory MUST re-export all 4 symbols connection-registry.ts imports
 * (connectInProcess, connectSpawn, connectCodexInProcess, decodeWireLine) —
 * omitting decodeWireLine crashes the import (not an assertion failure), since
 * connect()'s onFrame handler calls it.
 */

import * as os from "node:os"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createConnectionRegistry } from "./connection-registry.js"

// ── deferred connect control ──────────────────────────────────────────────────

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let currentDeferred: Deferred<ProviderConnection> | null = null

/** Build a minimal ProviderConnection stub (unused fields are cheap no-ops). */
function makeConnStub(): ProviderConnection & { close: ReturnType<typeof vi.fn> } {
  return {
    wire: { onLine: () => () => {}, write: () => true },
    capabilities: {
      mcp: false,
      compact: false,
      commands: false,
      usage: false,
      configOptions: false,
      rename: false,
      thinkingTokens: false,
      image: false,
      systemPrompt: "unsupported",
    },
    onFrame: () => () => {},
    turn: { isBusy: () => false, lastActivityAt: () => null, onChange: () => () => {} },
    onCrash: () => () => {},
    close: vi.fn(async () => {}),
    ext: undefined,
    pid: 12345,
  }
}

/** Reads the active deferred's promise at call-time (set by each test before connect()). */
function pendingConnectPromise(): Promise<ProviderConnection> {
  if (!currentDeferred) throw new Error("test setup error: currentDeferred not set")
  return currentDeferred.promise
}

// vi.mock is hoisted — factory can't close over outer `let` bindings assigned
// later, but it CAN read `currentDeferred` at call-time since it's a module-
// level `let` referenced (not captured-by-value) inside the factory function.
vi.mock("@drive-coding/provider/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@drive-coding/provider/connection")>()
  return {
    // decodeWireLine: real implementation — omitting it crashes the import
    // (connection-registry.ts:onFrame calls it), not just an assertion.
    decodeWireLine: actual.decodeWireLine,
    connectInProcess: vi.fn(() => pendingConnectPromise()),
    connectSpawn: vi.fn(() => pendingConnectPromise()),
    connectCodexInProcess: vi.fn(() => pendingConnectPromise()),
  }
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe("connection-registry — #7 DELETE-during-spawn race (mocked, deterministic)", () => {
  afterEach(() => {
    currentDeferred = null
    vi.clearAllMocks()
  })

  it("close() during in-flight connect() cancels the connect and leaves no entry", async () => {
    const reg = createConnectionRegistry()
    const deferred = createDeferred<ProviderConnection>()
    currentDeferred = deferred

    // Start connect (in-flight) — do NOT await yet.
    const connectPromise = reg.connect("race-1", "opencode", { cwd: os.tmpdir() })

    // DELETE arrives while spawn is still in-flight.
    await reg.close("race-1")

    // Now let the spawn resolve.
    const connStub = makeConnStub()
    deferred.resolve(connStub)

    // connect() must reject — cancelled by the concurrent close().
    await expect(connectPromise).rejects.toThrow(/cancelled by concurrent close/)

    // (a) the stub connection's close() must have been called (child not immortal).
    expect(connStub.close).toHaveBeenCalled()

    // (b) no entry left in the map.
    expect(reg.get("race-1")).toBeUndefined()
    expect(reg.getRuntimeInfo("race-1")).toBeNull()
  })

  it("double-connect guard: second connect() on same in-flight agentId rejects immediately", async () => {
    const reg = createConnectionRegistry()
    const deferred = createDeferred<ProviderConnection>()
    currentDeferred = deferred

    // First connect in-flight — never resolved during this test.
    const firstConnect = reg.connect("race-2", "opencode", { cwd: os.tmpdir() })

    // Second connect on the SAME agentId, while the first is still pending.
    await expect(reg.connect("race-2", "opencode", { cwd: os.tmpdir() })).rejects.toThrow(
      /already connecting/,
    )

    // Clean up: resolve the first connect so it doesn't leak a pending handle.
    deferred.resolve(makeConnStub())
    await firstConnect
    await reg.close("race-2")
  })
})
