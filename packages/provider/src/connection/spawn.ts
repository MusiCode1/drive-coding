/**
 * connection/spawn.ts — connectSpawn: ProviderConnection wrapping spawn-core.
 *
 * Wraps createSpawnCore + createTurnTracker + decodeWireLine to expose the
 * ProviderConnection primitive (CUT-3b-i).
 *
 * Key design decisions (from brief §3ג + avigail):
 *   - onFrame is a HOOK in createSpawnCore constructor (not a method).
 *   - All spawn-core calls require bridgeId (passed internally — single per connection).
 *   - onCrash is global on spawn-core → filter to our bridgeId only.
 *   - turn-tracker observed on dir==="in" only (matches bridge-manager.ts:97-99).
 *   - turn.onChange: derived from onFrame (busy changed → emit callback).
 *   - ext: undefined (spawn-native, no ext channel).
 */

import { randomUUID } from "node:crypto"
import { createSpawnCore } from "../shared/spawn-core.js"
import { extractPromptCaps } from "../shared/extract-prompt-caps.js"
import { createTurnTracker } from "../shared/turn-tracker.js"
import { decodeWireLine } from "../shared/wire-decode.js"
import type { SpawnBridgeInput } from "../spawn/index.js"
import { staticCapsFor } from "./capabilities-static.js"
import type { ConnectOpts, ProviderConnection, WireFrame } from "./types.js"

/**
 * connectSpawn — creates a ProviderConnection using spawn-core.
 *
 * @param cliKind - which CLI to spawn (e.g. "opencode", "claude")
 * @param opts    - ConnectOpts: cwd, optional shapeEnv
 * @returns       ProviderConnection ready to use
 */
export async function connectSpawn(
  cliKind: SpawnBridgeInput["cliKind"],
  opts: ConnectOpts,
): Promise<ProviderConnection> {
  const bridgeId = randomUUID()

  // Listeners for onFrame — broadcast decoded frames.
  const frameListeners = new Set<(f: WireFrame) => void>()

  // turn-tracker — pull-based busy indicator.
  const tracker = createTurnTracker()

  // onChange: last busy state emitted (used to detect transitions).
  let lastBusy = false
  const changeListeners = new Set<(busy: boolean) => void>()

  /** Emit onChange if busy state changed since last frame. */
  function emitBusyChange(): void {
    const nowBusy = tracker.isBusy(Date.now())
    if (nowBusy !== lastBusy) {
      lastBusy = nowBusy
      for (const cb of changeListeners) {
        try {
          cb(nowBusy)
        } catch {
          /* listener must not break the pipe */
        }
      }
    }
  }

  // createSpawnCore with onFrame + shapeEnv hooks.
  const core = createSpawnCore({
    shapeEnv: opts.shapeEnv,

    onFrame(bId: string, dir: "in" | "out", rawLine: string): void {
      // Filter: only care about our own bridgeId (spawn-core is single-bridge here,
      // but be defensive — matches brief §3ג "filter if bId===bridgeId").
      if (bId !== bridgeId) return

      // Normalize trailing \n (out direction may have it; in does not).
      const normalized = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine

      const s = decodeWireLine(normalized)

      // turn-tracker: observe on dir==="in" only (matches bridge-manager.ts:97-99).
      if (dir === "in") {
        tracker.observe(s, Date.now())
        emitBusyChange()
        // tap init-response: extract promptCapabilities.image from initialize result frame.
        const promptCaps = extractPromptCaps(s.parsed)
        if (promptCaps !== undefined) {
          caps = { ...caps, image: promptCaps.image }
        }
      }

      // Derive type label (brief §3ג).
      const type =
        s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")

      const frame: WireFrame = {
        dir,
        type,
        id: s.id,
        raw: normalized,
        parsed: s.parsed,
      }

      for (const cb of frameListeners) {
        try {
          cb(frame)
        } catch {
          /* listener must not break the pipe */
        }
      }
    },
  })

  // Spawn the process.
  const input: SpawnBridgeInput = {
    cliKind,
    cwd: opts.cwd,
    modelOverride: opts.modelOverride ?? null,
  }
  await core.spawnWithStderr(bridgeId, input)

  // capabilities: mutable internal state, updated by tap on init-response.
  // Base: staticCapsFor(cliKind) — static defaults per provider.
  // After initialize response arrives on dir="in": extractPromptCaps updates image field.
  // Exposed via getter so all consumers always read latest.
  let caps = staticCapsFor(cliKind)

  // Build the ProviderConnection.
  const connection: ProviderConnection = {
    wire: {
      onLine(cb: (line: string) => void): () => void {
        return core.onLine(bridgeId, cb)
      },
      write(line: string): boolean {
        return core.writeStdin(bridgeId, line)
      },
    },

    get capabilities() {
      return caps
    },

    onFrame(cb: (f: WireFrame) => void): () => void {
      frameListeners.add(cb)
      return () => {
        frameListeners.delete(cb)
      }
    },

    turn: {
      isBusy(): boolean {
        return tracker.isBusy(Date.now())
      },
      lastActivityAt(): number | null {
        return tracker.getLastActivityAt()
      },
      onChange(cb: (busy: boolean) => void): () => void {
        changeListeners.add(cb)
        return () => {
          changeListeners.delete(cb)
        }
      },
    },

    onCrash(cb: (info: import("../spawn/index.js").BridgeCrashInfo) => void): () => void {
      return core.onCrash((bId, info) => {
        if (bId === bridgeId) cb(info)
      })
    },

    async close(): Promise<void> {
      await core.kill(bridgeId)
    },

    ext: undefined,

    get pid(): number | null {
      return core.getChild(bridgeId)?.pid ?? null
    },
  }

  return connection
}
