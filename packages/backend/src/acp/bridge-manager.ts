/**
 * bridge-manager.ts — wrapper over createSpawnCore (CUT-2).
 *
 * Thin wrapper that delegates spawn/lifecycle/stdio to the generic createSpawnCore
 * from @drive-coding/provider/host, and injects 4 drive-coding-specific features
 * via hooks and local state:
 *
 *   shapeEnv  — opencode: inject OPENCODE_CONFIG_CONTENT + PROMPT_INJECTOR_TEXT.
 *   onFrame   — wire observability (decodeWireLine log + wireRecorder).
 *               turn-tracker.observe on dir:"in" only (matches live behaviour, bridge-manager.ts:176).
 *   attached  — markAttached/markDetached/getRuntimeInfo (active-agents panel).
 *   recs map  — per-bridge WireSession, init in spawnInternal path, cleanup on crash/exit.
 *
 * Known-equivalent: env-shaping order differs from the live monolith.
 *   live:    process.env → inject opencode-config → cli-spec unsetEnv/setEnv (last).
 *   wrapper: process.env → cli-spec unsetEnv/setEnv → shapeEnv hook (last).
 * For the default config (spec override JSONC does not touch OPENCODE_CONFIG_CONTENT
 * or PROMPT_INJECTOR_TEXT) the result is identical.  Smoke test confirms no override
 * stomps these vars in the regular config.
 *
 * API surface preserved exactly (§3 CUT-2 brief):
 *   spawnWithStderr, getChild, onLine, writeStdin,
 *   markAttached, markDetached, getRuntimeInfo, onCrash.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { BridgeCrashInfo, BridgeHandle, BridgeManager, SpawnBridgeInput } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { createSpawnCore, type SpawnCoreHandleWithStderr } from "@drive-coding/provider/host"
import { buildOpencodeConfigContent } from "../plugin-config.js"
import { AUDIO_FRIENDLY_PROMPT } from "../prompts/index.js"
import { decodeWireLine } from "../delivery/wire-decode.js"
import type { WireRecorder, WireSession } from "../delivery/wire-recorder.js"
import { type TurnTracker, createTurnTracker } from "./turn-tracker.js"

const wireLog = createLogger("backend.acp.wire")

/** Handle with stderr access and direct child reference — used internally by the orchestrator. */
export type BridgeHandleWithStderr = BridgeHandle & {
  readonly getStderr: () => string[]
  readonly child: ChildProcessWithoutNullStreams
}

export function createBridgeManager(opts?: { wireRecorder?: WireRecorder }): BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
  getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
  // active-agents panel (attached state)
  markAttached(bridgeId: string): void
  markDetached(bridgeId: string): void
  // slice active-agents + agent-busy-indicator: runtime enrichment for GET /api/agents
  getRuntimeInfo(
    bridgeId: string,
  ): { pid: number; attached: boolean; busy: boolean; lastMessageAt: number | null } | null
  // slice agent-busy-indicator: subscribe to stdout lines (permanent reader in bridge-manager)
  onLine(bridgeId: string, cb: (line: string) => void): () => void
  /** Write a line to child.stdin and record the out direction. Returns false if bridge not found. */
  writeStdin(bridgeId: string, line: string): boolean
} {
  const wireRecorder = opts?.wireRecorder

  // Wrapper-local state: per-bridge attached flag, turn-tracker, wire-session.
  // Keyed by bridgeId; entries created in spawnInternal, removed on crash/exit/kill.
  type WrapperEntry = {
    hasActiveWs: boolean
    tracker: TurnTracker
    rec: WireSession
  }
  const wrapperState = new Map<string, WrapperEntry>()

  const core = createSpawnCore({
    shapeEnv(cliKind, baseEnv) {
      // Inject opencode-config and audio-prompt for opencode only.
      // Matches live behaviour (bridge-manager.ts:82 live).
      // known-equivalent: shapeEnv runs after cli-spec (reversed vs live); see module doc.
      if (cliKind === "opencode") {
        return {
          ...baseEnv,
          OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(baseEnv.OPENCODE_CONFIG_CONTENT),
          PROMPT_INJECTOR_TEXT: AUDIO_FRIENDLY_PROMPT,
        }
      }
      return baseEnv
    },

    onFrame(bridgeId, dir, rawLine) {
      // Normalize out-direction line for decode/record (strip trailing \n if present).
      // In-direction lines arrive without \n (readline stripped); out is verbatim from writeStdin.
      const normalized = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine

      try {
        const s = decodeWireLine(normalized)
        const type =
          s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
        wireLog.debug({ bridgeId, dir, type, id: s.id }, "wire")
        if (!s.unparsed) wireLog.trace({ bridgeId, dir, frame: s.parsed }, "wire-full")

        // turn-tracker: observe on in-direction only (matches live, bridge-manager.ts:176).
        if (dir === "in") {
          wrapperState.get(bridgeId)?.tracker.observe(s, Date.now())
        }
      } catch {
        // silent — hook must not break the reader/writer
      }

      wrapperState.get(bridgeId)?.rec.record(dir, normalized)
    },
  })

  // Intercept crash/exit to clean up wrapper state.
  // onCrash fires for both crash and normal exit (spawn-core notifyCrash).
  core.onCrash((bridgeId) => {
    const entry = wrapperState.get(bridgeId)
    if (entry) {
      entry.rec.close()
      wrapperState.delete(bridgeId)
    }
  })

  async function spawnInternal(
    bridgeId: string,
    input: SpawnBridgeInput,
  ): Promise<SpawnCoreHandleWithStderr> {
    // Init wrapper state BEFORE core.spawnWithStderr — onFrame can fire during spawn.
    // Track whether THIS call created the entry: if a live bridge already owns the id,
    // a double-spawn must not clobber (or on failure delete) the existing entry.
    const created = !wrapperState.has(bridgeId)
    if (created) {
      const rec = wireRecorder?.open(bridgeId) ?? { record() {}, close() {} }
      wrapperState.set(bridgeId, {
        hasActiveWs: false,
        tracker: createTurnTracker(),
        rec,
      })
    }
    try {
      return await core.spawnWithStderr(bridgeId, input)
    } catch (err) {
      // Spawn failed — clean up wrapper entry only if THIS call created it.
      // Double-spawn on a live bridge: core throws "already exists", but the
      // existing wrapperState entry belongs to the first (live) bridge — do not touch it.
      if (created) {
        wrapperState.get(bridgeId)?.rec.close()
        wrapperState.delete(bridgeId)
      }
      throw err
    }
  }

  return {
    // BridgeManager base — delegate fully to core
    async spawn(bridgeId, input) {
      return spawnInternal(bridgeId, input)
    },

    get(bridgeId) {
      return core.get(bridgeId)
    },

    list() {
      return core.list()
    },

    async kill(bridgeId) {
      // Close wire session before kill (matches live kill() behaviour).
      const entry = wrapperState.get(bridgeId)
      if (entry) {
        entry.rec.close()
        wrapperState.delete(bridgeId)
      }
      return core.kill(bridgeId)
    },

    onCrash(handler: (bridgeId: string, info: BridgeCrashInfo) => void) {
      return core.onCrash(handler)
    },

    // Extended surface — delegate to core
    async spawnWithStderr(bridgeId, input) {
      return spawnInternal(bridgeId, input)
    },

    getChild(bridgeId) {
      return core.getChild(bridgeId)
    },

    onLine(bridgeId, cb) {
      return core.onLine(bridgeId, cb)
    },

    writeStdin(bridgeId, line) {
      return core.writeStdin(bridgeId, line)
    },

    // Wrapper-only: attached state
    markAttached(bridgeId: string) {
      const e = wrapperState.get(bridgeId)
      if (e) e.hasActiveWs = true
    },

    markDetached(bridgeId: string) {
      const e = wrapperState.get(bridgeId)
      if (e) e.hasActiveWs = false
    },

    // Wrapper-only: runtime info (pid from core, attached/busy/lastMessageAt from wrapper)
    getRuntimeInfo(
      bridgeId: string,
    ): { pid: number; attached: boolean; busy: boolean; lastMessageAt: number | null } | null {
      const child = core.getChild(bridgeId)
      if (!child) return null
      const e = wrapperState.get(bridgeId)
      if (!e) return null
      return {
        pid: child.pid ?? 0,
        attached: e.hasActiveWs,
        busy: e.tracker.isBusy(Date.now()),
        lastMessageAt: e.tracker.getLastActivityAt(),
      }
    },
  }
}
