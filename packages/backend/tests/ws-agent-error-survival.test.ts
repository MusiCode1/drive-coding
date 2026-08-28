/**
 * ws-agent-error-survival.test.ts — integration tests (CUT-3b-ii rewire)
 *
 * Verifies: feWs "error" event does NOT kill the child process (conn.close NOT called),
 * and cleanup is idempotent when both "error" and "close" fire.
 *
 * CUT-3b-ii: uses createConnectionRegistry instead of createBridgeManager.
 * Real child processes spawned via connectSpawn (OPENCODE_BIN override).
 */

import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WebSocket } from "ws"
import { createConnectionRegistry } from "../src/acp/connection-registry.js"
import { createAgentWsHandler } from "../src/delivery/ws-agent.js"

// ─── helpers ──────────────────────────────────────────────────────────────────

let acpScriptPath: string | null = null
const openConns: ProviderConnection[] = []

function getAcpScript(): string {
  if (!acpScriptPath) {
    const tmpDir = os.tmpdir()
    acpScriptPath = path.join(tmpDir, "acp-error-survival-test.mjs")
    fs.writeFileSync(acpScriptPath, "setInterval(() => {}, 99999);\n", "utf8")
  }
  return acpScriptPath
}

function useScript(scriptPath: string): () => void {
  const prevBin = process.env.OPENCODE_BIN
  const prevArgs = process.env.OPENCODE_ARGS
  process.env.OPENCODE_BIN = process.execPath
  process.env.OPENCODE_ARGS = JSON.stringify([scriptPath])
  return () => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    if (prevArgs === undefined) delete process.env.OPENCODE_ARGS
    else process.env.OPENCODE_ARGS = prevArgs
  }
}

async function spawnConn(
  reg: ReturnType<typeof createConnectionRegistry>,
  agentId: string,
): Promise<ProviderConnection> {
  getAcpScript()
  const cleanup = useScript(acpScriptPath!)
  try {
    const conn = await reg.connect(agentId, "opencode", { cwd: os.tmpdir() })
    openConns.push(conn)
    return conn
  } finally {
    cleanup()
  }
}

/** Mock feWs: EventEmitter + send/close no-ops, cast to ws.WebSocket. */
function createMockWs(): WebSocket {
  const emitter = new EventEmitter()
  const mock = Object.assign(emitter, {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  })
  return mock as unknown as WebSocket
}

// ─── cleanup ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  for (const conn of openConns) {
    try {
      await conn.close()
    } catch {
      /* already dead */
    }
  }
  openConns.length = 0
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ws-agent — feWs error handler + idempotent detach (CUT-3b-ii)", () => {
  it("child survives a feWs 'error' event (dirty disconnect does not call conn.close)", async () => {
    const reg = createConnectionRegistry()
    const agentId = "error-survival-1"
    await spawnConn(reg, agentId)

    const conn = reg.get(agentId)
    expect(conn).not.toBeUndefined()
    expect(conn!.pid).toBeGreaterThan(0)

    const closeSpy = vi.spyOn(conn!, "close")

    const { onConnect } = createAgentWsHandler({
      orchestrator: { getBridgePort: vi.fn(() => 0) } as never,
      connectionRegistry: reg,
    })

    const mockWs = createMockWs()
    await onConnect(mockWs, agentId)

    mockWs.emit("error", new Error("ECONNRESET"))

    await new Promise((r) => setTimeout(r, 50))

    // conn.close must NOT be called — dirty disconnect does NOT kill the connection
    expect(closeSpy).not.toHaveBeenCalled()
    // connection still in registry (not closed)
    expect(reg.get(agentId)).not.toBeUndefined()
  }, 15000)

  it("detach is idempotent: error + close both fire → removeConnection called exactly once", async () => {
    const reg = createConnectionRegistry()
    const agentId = "error-survival-2"
    await spawnConn(reg, agentId)

    const removeConnectionSpy = vi.spyOn(reg, "removeConnection")

    const { onConnect } = createAgentWsHandler({
      orchestrator: { getBridgePort: vi.fn(() => 0) } as never,
      connectionRegistry: reg,
    })

    const mockWs = createMockWs()
    await onConnect(mockWs, agentId)

    mockWs.emit("error", new Error("ECONNRESET"))
    mockWs.emit("close")

    await new Promise((r) => setTimeout(r, 50))

    expect(removeConnectionSpy).toHaveBeenCalledTimes(1)
  }, 15000)

  it("after error-detach, a second connection to same agentId succeeds (activeFeWs cleared)", async () => {
    const reg = createConnectionRegistry()
    const agentId = "error-survival-3"
    await spawnConn(reg, agentId)

    const { onConnect } = createAgentWsHandler({
      orchestrator: { getBridgePort: vi.fn(() => 0) } as never,
      connectionRegistry: reg,
    })

    const mockWs1 = createMockWs()
    await onConnect(mockWs1, agentId)

    mockWs1.emit("error", new Error("ECONNRESET"))
    await new Promise((r) => setTimeout(r, 50))

    const mockWs2 = createMockWs()
    await onConnect(mockWs2, agentId)

    const closeCalls = (mockWs2.close as ReturnType<typeof vi.fn>).mock.calls as Array<unknown[]>
    const rejectedAsInUse = closeCalls.some(
      (args) =>
        args[0] === 1008 &&
        typeof args[1] === "string" &&
        (args[1] as string).includes("another tab"),
    )
    expect(rejectedAsInUse).toBe(false)
  }, 15000)

  it("clean 'close' event also keeps child alive (regression: DoD #5)", async () => {
    const reg = createConnectionRegistry()
    const agentId = "error-survival-4"
    await spawnConn(reg, agentId)

    const conn = reg.get(agentId)
    const closeSpy = vi.spyOn(conn!, "close")

    const { onConnect } = createAgentWsHandler({
      orchestrator: { getBridgePort: vi.fn(() => 0) } as never,
      connectionRegistry: reg,
    })

    const mockWs = createMockWs()
    await onConnect(mockWs, agentId)

    mockWs.emit("close")

    await new Promise((r) => setTimeout(r, 50))

    // conn.close must NOT be called after a clean disconnect
    expect(closeSpy).not.toHaveBeenCalled()
    // pid still valid
    expect(conn!.pid).toBeGreaterThan(0)
  }, 15000)
})
