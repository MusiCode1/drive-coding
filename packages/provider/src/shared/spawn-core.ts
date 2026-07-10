/**
 * spawn-core.ts — spawn process generic + extension hooks.
 *
 * Generic spawn lifecycle for any CLI child process.
 * Zero knowledge of opencode / audio / wire / turn / decode.
 * All product-specific capabilities are injected via SpawnCoreHooks.
 *
 * Newline contract for onFrame:
 *   dir:"in"  — line WITHOUT trailing \n (readline already stripped it).
 *   dir:"out" — line VERBATIM as passed to writeStdin (may include \n).
 *   Normalization (slice of trailing \n for record/decode) is the WRAPPER's responsibility.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { createLogger } from "@drive-coding/core/log"
import { getCliCommand, getCliSpec } from "../config/index.js"
import { logIfSlow, markStart } from "./hot-path-timing.js"
import type {
  BridgeCrashInfo,
  BridgeHandle,
  BridgeManager,
  SpawnBridgeInput,
} from "../spawn/index.js"

const log = createLogger("provider.host.spawn-core")
const STDERR_MAX_LINES = 200

export interface SpawnCoreHooks {
  /**
   * Shape the child env before spawn.
   * Called with (cliKind, baseEnv) — return the final env.
   * Drive-coding uses this to inject audio-prompt + opencode-config.
   */
  shapeEnv?: (cliKind: SpawnBridgeInput["cliKind"], baseEnv: NodeJS.ProcessEnv) => NodeJS.ProcessEnv

  /**
   * Observer for every frame (in/out).
   * dir:"in"  — rawLine has no trailing \n (readline stripped it).
   * dir:"out" — rawLine is verbatim from writeStdin (may include \n).
   * Drive-coding uses this for wire-log + recorder + turn-tracker.
   */
  onFrame?: (bridgeId: string, dir: "in" | "out", rawLine: string) => void
}

/** Extended handle with stderr access and direct child reference. */
export type SpawnCoreHandleWithStderr = BridgeHandle & {
  readonly getStderr: () => string[]
  readonly child: ChildProcessWithoutNullStreams
}

/** Full SpawnCore surface — generic BridgeManager + extended helpers. */
export type SpawnCore = BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<SpawnCoreHandleWithStderr>
  getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
  onLine(bridgeId: string, cb: (line: string) => void): () => void
  writeStdin(bridgeId: string, line: string): boolean
}

export function createSpawnCore(hooks?: SpawnCoreHooks): SpawnCore {
  type Entry = {
    handle: BridgeHandle
    child: ChildProcessWithoutNullStreams
    stderrLines: string[]
    lineSubscribers: Set<(line: string) => void>
  }
  const store = new Map<string, Entry>()
  const crashHandlers = new Set<(bridgeId: string, info: BridgeCrashInfo) => void>()

  function notifyCrash(bridgeId: string, info: BridgeCrashInfo): void {
    for (const handler of crashHandlers) {
      try {
        handler(bridgeId, info)
      } catch (e) {
        log.warn({ err: e, bridgeId }, "crash handler threw")
      }
    }
  }

  async function spawnInternal(
    bridgeId: string,
    input: SpawnBridgeInput,
  ): Promise<SpawnCoreHandleWithStderr> {
    if (store.has(bridgeId)) throw new Error(`Bridge ${bridgeId} already exists`)

    const cli = getCliCommand(input.cliKind, input.modelOverride)
    const childLog = log.child({ bridgeId, cwd: input.cwd, bin: cli.bin })
    childLog.info({}, "spawn start")

    const stderrLines: string[] = []
    let stderrPartial = ""

    // Base env: process.env shaped by cli-spec (unsetEnv/setEnv), then shapeEnv hook.
    const baseEnv: NodeJS.ProcessEnv = { ...process.env }
    const spec = getCliSpec(input.cliKind, process.env)
    for (const key of spec?.unsetEnv ?? []) {
      delete baseEnv[key]
    }
    if (spec?.setEnv) {
      Object.assign(baseEnv, spec.setEnv)
    }

    // shapeEnv hook: consumer (e.g. drive-coding wrapper) injects product-specific vars.
    const childEnv = hooks?.shapeEnv ? hooks.shapeEnv(input.cliKind, baseEnv) : baseEnv

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(cli.bin, [...cli.args], {
        cwd: input.cwd,
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch (err) {
      childLog.warn({ err }, "spawn threw synchronously")
      throw err
    }

    // Register listeners immediately — before any async tick can fire an error.
    child.on("error", (err) => {
      const errnoErr = err as NodeJS.ErrnoException
      childLog.warn({ err: { message: err.message, code: errnoErr.code } }, "child error event")
      if (!child.pid && store.has(bridgeId)) {
        store.delete(bridgeId)
        notifyCrash(bridgeId, {
          exitCode: null,
          signal: null,
          spawnError: { code: errnoErr.code, message: err.message },
        })
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      const text = stderrPartial + chunk.toString("utf8")
      const parts = text.split("\n")
      for (let i = 0; i < parts.length - 1; i++) {
        stderrLines.push(parts[i] ?? "")
        if (stderrLines.length > STDERR_MAX_LINES) stderrLines.shift()
      }
      stderrPartial = parts[parts.length - 1] ?? ""
    })

    child.on("exit", (code, signal) => {
      childLog.info({ code, signal }, "child exit")
      if (store.has(bridgeId)) {
        store.delete(bridgeId)
        notifyCrash(bridgeId, { exitCode: code, signal: signal ?? null })
      }
    })

    // Permanent stdout reader — bridge-manager owns child.stdout.
    // ws-agent subscribes via onLine() and receives lines via callback.
    // Order is critical: lineSubscribers (-> ws send) BEFORE onFrame.
    child.stdout.setEncoding("utf8")
    const stdoutRl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    stdoutRl.on("line", (line) => {
      const entry = store.get(bridgeId)
      if (!entry) return
      // (1) subscribers first (ws-agent -> feWs.send) — timed (hot-path)
      const t = markStart()
      for (const cb of entry.lineSubscribers) {
        try {
          cb(line)
        } catch {
          /* subscriber must not break the pipe */
        }
      }
      logIfSlow("readline-dispatch", t, { bytes: line.length })
      // (2) onFrame hook: dir:"in", line has no \n (readline stripped it)
      try {
        hooks?.onFrame?.(bridgeId, "in", line)
      } catch {
        /* silent — hook must not break the reader */
      }
    })

    if (!child.pid) {
      throw new Error(`spawn returned no pid (bin=${cli.bin})`)
    }

    const handle: BridgeHandle = {
      bridgeId,
      cliKind: input.cliKind,
      cwd: input.cwd,
      port: 0,
      pid: child.pid,
      wsUrl: "",
      startedAt: new Date(),
    }

    store.set(bridgeId, {
      handle,
      child,
      stderrLines,
      lineSubscribers: new Set(),
    })
    childLog.info({ pid: child.pid }, "spawn ok")
    return { ...handle, getStderr: () => [...stderrLines], child }
  }

  return {
    async spawn(bridgeId, input) {
      return spawnInternal(bridgeId, input)
    },

    async spawnWithStderr(bridgeId, input) {
      return spawnInternal(bridgeId, input)
    },

    get(bridgeId) {
      return store.get(bridgeId)?.handle ?? null
    },

    getChild(bridgeId) {
      return store.get(bridgeId)?.child ?? null
    },

    list() {
      return [...store.values()].map((e) => e.handle)
    },

    async kill(bridgeId) {
      const entry = store.get(bridgeId)
      if (!entry) return false
      log.info({ bridgeId }, "kill")
      // Remove before exit event fires — prevents notifyCrash on intentional kill.
      store.delete(bridgeId)
      return new Promise<boolean>((resolve) => {
        entry.child.once("exit", () => resolve(true))
        entry.child.kill("SIGTERM")
        setTimeout(() => entry.child.kill("SIGKILL"), 5000)
      })
    },

    onCrash(handler: (bridgeId: string, info: BridgeCrashInfo) => void) {
      crashHandlers.add(handler)
      return () => {
        crashHandlers.delete(handler)
      }
    },

    onLine(bridgeId: string, cb: (line: string) => void): () => void {
      const e = store.get(bridgeId)
      if (!e) return () => {}
      e.lineSubscribers.add(cb)
      return () => {
        e.lineSubscribers.delete(cb)
      }
    },

    writeStdin(bridgeId: string, line: string): boolean {
      const entry = store.get(bridgeId)
      if (!entry) return false
      const t = markStart()
      entry.child.stdin.write(line)
      logIfSlow("writeStdin", t, { bytes: line.length })
      // onFrame hook: dir:"out", line verbatim (may include \n — wrapper normalizes).
      try {
        hooks?.onFrame?.(bridgeId, "out", line)
      } catch {
        /* silent */
      }
      return true
    },
  }
}
