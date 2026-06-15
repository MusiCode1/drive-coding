/**
 * reaper-pin.test.ts — integration test for reapIdleBridges + persistent flag.
 *
 * slice active-agents-backend commit 3.
 * Uses real registry + bridgeManager + orchestrator with a spawned child process.
 * Cross-platform: process.execPath (node/bun) + acp script in os.tmpdir().
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createBridgeManager } from "../src/acp/bridge-manager.js"
import { createInMemoryAgentRegistry } from "../src/agents/registry.js"
import { createAgentOrchestrator } from "../src/app/agent-orchestrator.js"
import { reapIdleBridges } from "../src/acp/reap-idle.js"

// Timeout small enough to make bridges idle quickly in tests
const TIMEOUT_MS = 500

let acpScriptPath: string | null = null

function getAcpScript(): string {
  if (!acpScriptPath) {
    const tmpDir = os.tmpdir()
    acpScriptPath = path.join(tmpDir, "acp")
    fs.writeFileSync(acpScriptPath, "setInterval(() => {}, 99999)\n", "utf8")
  }
  return acpScriptPath
}

async function spawnTestBridge(
  bm: ReturnType<typeof createBridgeManager>,
  id: string,
): Promise<void> {
  getAcpScript()  // ensure script exists
  const original = process.env.OPENCODE_BIN
  process.env.OPENCODE_BIN = process.execPath
  try {
    await bm.spawnWithStderr(id, {
      cliKind: "opencode",
      cwd: os.tmpdir(),
      modelOverride: null,
    })
  } finally {
    if (original === undefined) {
      delete process.env.OPENCODE_BIN
    } else {
      process.env.OPENCODE_BIN = original
    }
  }
}

describe("reapIdleBridges — persistent pin (slice active-agents)", () => {
  let bm: ReturnType<typeof createBridgeManager>
  let registry: ReturnType<typeof createInMemoryAgentRegistry>
  let orchestrator: ReturnType<typeof createAgentOrchestrator>

  beforeEach(() => {
    bm = createBridgeManager()
    registry = createInMemoryAgentRegistry()
    orchestrator = createAgentOrchestrator({ registry, bridgeManager: bm })
  })

  afterEach(async () => {
    // Kill all remaining bridges
    const handles = bm.list()
    const waiters: Promise<void>[] = []
    for (const h of handles) {
      const child = bm.getChild(h.bridgeId)
      if (child && !child.killed && child.exitCode === null) {
        const p = new Promise<void>((resolve) => {
          child.once("exit", resolve)
          child.once("error", resolve)
        })
        try { child.kill("SIGKILL") } catch { /* already dead */ }
        waiters.push(p)
      }
    }
    await Promise.all(waiters)
  })

  it("unpinned agent + detached + timeout → reaper kills it (bridge removed, registry empty)", async () => {
    // Create agent via registry (has persistent: false by default).
    // cwd must start with "/" (validateCwd requirement); bridge spawns from os.tmpdir() separately.
    const agent = await registry.create({ cliKind: "opencode", cwd: "/tmp" })
    await spawnTestBridge(bm, agent.id)

    // Mark as attached then detached (simulates WS connect + disconnect)
    bm.markAttached(agent.id)
    bm.markDetached(agent.id)

    // Simulate time passing beyond timeout
    const now = Date.now() + TIMEOUT_MS + 100

    // Confirm it's idle
    const idle = bm.listIdle(TIMEOUT_MS, now)
    expect(idle).toContain(agent.id)

    // Run reaper
    await reapIdleBridges({ bridgeManager: bm, registry, orchestrator, timeoutMs: TIMEOUT_MS }, now)

    // Agent should be gone from registry and bridge removed
    const agentAfter = await registry.get(agent.id)
    expect(agentAfter).toBeNull()

    const bridgeAfter = bm.get(agent.id)
    expect(bridgeAfter).toBeNull()
  })

  it("pinned agent (persistent=true) + detached + timeout → reaper skips it (bridge alive)", async () => {
    // Create agent and pin it
    const agent = await registry.create({ cliKind: "opencode", cwd: "/tmp" })
    await spawnTestBridge(bm, agent.id)
    await registry.update(agent.id, { persistent: true })

    // Mark as attached then detached
    bm.markAttached(agent.id)
    bm.markDetached(agent.id)

    // Simulate time passing beyond timeout
    const now = Date.now() + TIMEOUT_MS + 100

    // Confirm it's idle
    const idle = bm.listIdle(TIMEOUT_MS, now)
    expect(idle).toContain(agent.id)

    // Run reaper — should skip pinned agent
    await reapIdleBridges({ bridgeManager: bm, registry, orchestrator, timeoutMs: TIMEOUT_MS }, now)

    // Agent should still be in registry and bridge still alive
    const agentAfter = await registry.get(agent.id)
    expect(agentAfter).not.toBeNull()
    expect(agentAfter?.persistent).toBe(true)

    const bridgeAfter = bm.get(agent.id)
    expect(bridgeAfter).not.toBeNull()
  })
})
