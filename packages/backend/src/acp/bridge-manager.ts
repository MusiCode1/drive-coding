/**
 * bridge-manager.ts — wrapper דק שמזריק 4 פיצ'רי-drive-coding לתוך spawn-core הגנרי.
 *
 * spawn-core (provider/host) מחזיק את ה-spawn lifecycle הגנרי.
 * ה-wrapper מזריק: prompt-injection, opencode plugin-config, wire-observability, turn-tracking.
 *
 * ⚠️ שני מסלולי-spawn מאתחלים tracker/rec — spawn() וגם spawnWithStderr() (מסלול הייצור!).
 *    agent-orchestrator.ts משתמש ב-spawnWithStderr — פספוס → busy/record/turn מתים בשקט.
 *
 * ⚠️ core.onCrash מחווט לcleanupBridge — בלעדיו: crash → tracker/recs/attached דולפים.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { createLogger } from "@drive-coding/core/log"
import { createSpawnCore } from "@drive-coding/provider/host"
import type {
  BridgeCrashInfo,
  BridgeHandle,
  BridgeManager,
  SpawnBridgeInput,
} from "@drive-coding/provider/spawn"
import { decodeWireLine } from "../delivery/wire-decode.js"
import type { WireRecorder, WireSession } from "../delivery/wire-recorder.js"
import { buildOpencodeConfigContent } from "../plugin-config.js"
import { AUDIO_FRIENDLY_PROMPT } from "../prompts/index.js"
import { createTurnTracker, type TurnTracker } from "./turn-tracker.js"

const wireLog = createLogger("backend.acp.wire")

/** Handle מורחב עם גישה ל-stderr ו-child ישיר — משמש פנימית את ה-orchestrator. */
export type BridgeHandleWithStderr = BridgeHandle & {
  readonly getStderr: () => string[]
  readonly child: ChildProcessWithoutNullStreams
}

export function createBridgeManager(opts?: { wireRecorder?: WireRecorder }): BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
  getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
  // ─── תצוגת active-agents (attached) ───
  markAttached(bridgeId: string): void
  markDetached(bridgeId: string): void
  // slice active-agents + agent-busy-indicator: runtime enrichment for GET /api/agents
  getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean; busy: boolean } | null
  // slice agent-busy-indicator: subscription לשורות stdout (reader קבוע ב-bridge-manager)
  onLine(bridgeId: string, cb: (line: string) => void): () => void
  /** כותב שורה ל-child.stdin ומתעד את כיוון ה-out. מחזיר false אם ה-bridge לא קיים. */
  writeStdin(bridgeId: string, line: string): boolean
} {
  const trackers = new Map<string, TurnTracker>()
  const attached = new Map<string, boolean>()
  const recs = new Map<string, WireSession>()

  const core = createSpawnCore({
    // ── hook 1: shapeEnv ── prompt-injection + opencode plugin-config ──
    shapeEnv: (cliKind, base) =>
      cliKind === "opencode"
        ? {
            ...base,
            OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(base.OPENCODE_CONFIG_CONTENT),
            PROMPT_INJECTOR_TEXT: AUDIO_FRIENDLY_PROMPT,
          }
        : base,

    // ── hook 2: onFrame ── wire-observability + recording + turn-tracking ──
    // Newline contract (from spawn-core):
    //   dir:"in"  — rawLine has no trailing \n (readline stripped).
    //   dir:"out" — rawLine verbatim (may include \n).
    // Normalization for decode/record: strip trailing \n if present.
    onFrame: (id, dir, line) => {
      const raw = line.endsWith("\n") ? line.slice(0, -1) : line
      try {
        const s = decodeWireLine(raw)
        const type =
          s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
        wireLog.debug({ bridgeId: id, dir, type, id: s.id }, "wire")
        if (!s.unparsed) wireLog.trace({ bridgeId: id, dir, frame: s.parsed }, "wire-full")
        if (dir === "in") trackers.get(id)?.observe(s, Date.now())
      } catch {
        /* silent */
      }
      recs.get(id)?.record(dir, raw)
    },
  })

  // ── per-bridge init — called by BOTH spawn paths ──
  // ⚠️ Must be called for spawn() AND spawnWithStderr() (production path — agent-orchestrator:147-148).
  function initBridge(id: string): void {
    trackers.set(id, createTurnTracker())
    recs.set(id, opts?.wireRecorder?.open(id) ?? { record() {}, close() {} })
  }

  function cleanupBridge(id: string): void {
    recs.get(id)?.close()
    trackers.delete(id)
    recs.delete(id)
    attached.delete(id)
  }

  // ⚠️ Crash cleanup — must be wired; without this, trackers/recs/attached leak on crash.
  core.onCrash((id) => cleanupBridge(id))

  return {
    // ── spawn paths — both init bridge state ──
    async spawn(bridgeId, input) {
      initBridge(bridgeId)
      return core.spawn(bridgeId, input)
    },

    // ⚠️ Production path — agent-orchestrator.ts uses spawnWithStderr.
    // Returns getStderr+child from core (SpawnCoreHandleWithStderr satisfies BridgeHandleWithStderr).
    async spawnWithStderr(bridgeId, input) {
      initBridge(bridgeId)
      return core.spawnWithStderr(bridgeId, input)
    },

    // kill: cleanup before delegation — prevents double-notify (original: store.delete before exit-event).
    async kill(bridgeId) {
      cleanupBridge(bridgeId)
      return core.kill(bridgeId)
    },

    // ── delegated directly from core ──
    get(bridgeId) {
      return core.get(bridgeId)
    },
    list() {
      return core.list()
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
    onCrash(handler: (bridgeId: string, info: BridgeCrashInfo) => void) {
      return core.onCrash(handler)
    },

    // ─── תצוגת active-agents (attached) ───
    markAttached(bridgeId: string) {
      attached.set(bridgeId, true)
    },

    markDetached(bridgeId: string) {
      attached.set(bridgeId, false)
    },

    // slice active-agents + agent-busy-indicator: returns { pid, attached, busy } for a live bridge, or null
    getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean; busy: boolean } | null {
      const h = core.get(bridgeId)
      const t = trackers.get(bridgeId)
      if (!h) return null
      return {
        pid: h.pid,
        attached: attached.get(bridgeId) ?? false,
        busy: t?.isBusy(Date.now()) ?? false,
      }
    },
  }
}
