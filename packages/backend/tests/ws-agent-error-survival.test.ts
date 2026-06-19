/**
 * ws-agent-error-survival.test.ts — integration tests for Commit 0
 *
 * Verifies: feWs "error" event does NOT kill the child process, and cleanup
 * is idempotent when both "error" and "close" fire.
 *
 * Pattern: spawns a real child via createBridgeManager() (same as
 * bridge-manager.runtime.test.ts), then emits "error" on a mock feWs and
 * asserts child survival.
 *
 * The mock feWs is an EventEmitter with send/close no-ops — cast to
 * ws.WebSocket via `as unknown as WebSocket` since ws.WebSocket extends
 * EventEmitter and emit("error") will trigger the listener at runtime.
 */

import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WebSocket } from "ws"
import { createBridgeManager } from "../src/acp/bridge-manager.js"
import { createAgentWsHandler } from "../src/delivery/ws-agent.js"
import { createWireRecorder } from "../src/delivery/wire-recorder.js"

// ─── helpers ──────────────────────────────────────────────────────────────────

const noopWireRecorder = createWireRecorder({ dir: null })
let acpScriptPath: string | null = null
let spawnedChildren: ChildProcessWithoutNullStreams[] = []

function getAcpScript(): string {
  if (!acpScriptPath) {
    const tmpDir = os.tmpdir()
    acpScriptPath = path.join(tmpDir, "acp-error-survival-test.js")
    // Minimal long-lived script (keeps process alive like real ACP child)
    fs.writeFileSync(acpScriptPath, "setInterval(() => {}, 99999)\n", "utf8")
  }
  return acpScriptPath
}

async function spawnBridge(
  bm: ReturnType<typeof createBridgeManager>,
  id: string,
): Promise<void> {
  getAcpScript() // ensure script exists
  const origBin = process.env.OPENCODE_BIN
  const origArgs = process.env.OPENCODE_ARGS
  // Use node as the binary, and OPENCODE_ARGS to pass "-e setInterval(()=>{},99999)"
  // so the child stays alive without needing the real "acp" subcommand.
  process.env.OPENCODE_BIN = process.execPath
  process.env.OPENCODE_ARGS = JSON.stringify(["-e", "setInterval(()=>{},99999)"])
  try {
    await bm.spawnWithStderr(id, {
      cliKind: "opencode",
      cwd: os.tmpdir(),
      modelOverride: null,
    })
  } finally {
    if (origBin === undefined) {
      delete process.env.OPENCODE_BIN
    } else {
      process.env.OPENCODE_BIN = origBin
    }
    if (origArgs === undefined) {
      delete process.env.OPENCODE_ARGS
    } else {
      process.env.OPENCODE_ARGS = origArgs
    }
  }
  const child = bm.getChild(id)
  if (child) spawnedChildren.push(child)
}

/** Mock feWs: EventEmitter + send/close no-ops, cast to ws.WebSocket. */
function createMockWs(): WebSocket {
  const emitter = new EventEmitter()
  const mock = Object.assign(emitter, {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
  })
  return mock as unknown as WebSocket
}

// ─── cleanup ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  const waiting: Promise<void>[] = []
  for (const p of spawnedChildren) {
    if (!p.killed && p.exitCode === null) {
      const done = new Promise<void>((resolve) => {
        p.once("exit", () => resolve())
        p.once("error", () => resolve())
      })
      try {
        p.kill("SIGKILL")
      } catch {
        // already dead
      }
      waiting.push(done)
    }
  }
  await Promise.all(waiting)
  spawnedChildren = []
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ws-agent — feWs error handler + idempotent detach (Commit 0)", () => {
  it("child survives a feWs 'error' event (dirty disconnect does not kill child)", async () => {
    const bm = createBridgeManager()
    const agentId = "error-survival-1"
    await spawnBridge(bm, agentId)

    const child = bm.getChild(agentId)
    expect(child).not.toBeNull()
    expect(child!.exitCode).toBeNull()

    const handler = createAgentWsHandler({
      orchestrator: { getAgent: () => null } as never,
      bridgeManager: bm,
      wireRecorder: noopWireRecorder,
    })

    const mockWs = createMockWs()
    handler(mockWs, agentId)

    // Simulate dirty disconnect
    mockWs.emit("error", new Error("ECONNRESET"))

    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 50))

    // Child must still be alive — dirty disconnect does NOT kill it
    expect(child!.exitCode).toBeNull()
  }, 15000)

  it("detach is idempotent: error + close both fire → markDetached called exactly once", async () => {
    const bm = createBridgeManager()
    const agentId = "error-survival-2"
    await spawnBridge(bm, agentId)

    const markDetachedSpy = vi.spyOn(bm, "markDetached")

    const handler = createAgentWsHandler({
      orchestrator: { getAgent: () => null } as never,
      bridgeManager: bm,
      wireRecorder: noopWireRecorder,
    })

    const mockWs = createMockWs()
    handler(mockWs, agentId)

    // Both error and close fire (ws library may emit both on dirty disconnect)
    mockWs.emit("error", new Error("ECONNRESET"))
    mockWs.emit("close")

    await new Promise((r) => setTimeout(r, 50))

    // Idempotent: markDetached called exactly once despite two events
    expect(markDetachedSpy).toHaveBeenCalledTimes(1)
  }, 15000)

  it("after error-detach, a second connection to same agentId succeeds (activeFeWs cleared)", async () => {
    const bm = createBridgeManager()
    const agentId = "error-survival-3"
    await spawnBridge(bm, agentId)

    const handler = createAgentWsHandler({
      orchestrator: { getAgent: () => null } as never,
      bridgeManager: bm,
      wireRecorder: noopWireRecorder,
    })

    // First connection
    const mockWs1 = createMockWs()
    handler(mockWs1, agentId)

    // Dirty disconnect
    mockWs1.emit("error", new Error("ECONNRESET"))
    await new Promise((r) => setTimeout(r, 50))

    // Second connection to same agentId should NOT be rejected with 1008
    const mockWs2 = createMockWs()
    handler(mockWs2, agentId)

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
    const bm = createBridgeManager()
    const agentId = "error-survival-4"
    await spawnBridge(bm, agentId)

    const child = bm.getChild(agentId)
    expect(child).not.toBeNull()

    const handler = createAgentWsHandler({
      orchestrator: { getAgent: () => null } as never,
      bridgeManager: bm,
      wireRecorder: noopWireRecorder,
    })

    const mockWs = createMockWs()
    handler(mockWs, agentId)

    // Clean disconnect
    mockWs.emit("close")

    await new Promise((r) => setTimeout(r, 50))

    // Child must still be alive after a clean disconnect
    expect(child!.exitCode).toBeNull()
  }, 15000)
})
