import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import type { BridgeCrashInfo, BridgeHandle, BridgeManager, SpawnBridgeInput } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { buildOpencodeConfigContent } from "../plugin-config.js"
import { getCliCommand } from "./cli-config.js"

const log = createLogger("backend.bridge.manager")
const STDERR_MAX_LINES = 200

/** Extended handle with stderr access and direct child — used internally by orchestrator. */
export type BridgeHandleWithStderr = BridgeHandle & {
  readonly getStderr: () => string[]
  readonly child: ChildProcessWithoutNullStreams
}

export function createBridgeManager(): BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
  getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
} {
  type Entry = {
    handle: BridgeHandle
    child: ChildProcessWithoutNullStreams
    stderrLines: string[]
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
  ): Promise<BridgeHandleWithStderr> {
    if (store.has(bridgeId)) throw new Error(`Bridge ${bridgeId} already exists`)

    const cli = getCliCommand(input.cliKind, input.modelOverride)
    const childLog = log.child({ bridgeId, cwd: input.cwd, bin: cli.bin })
    childLog.info({}, "spawn start")

    const stderrLines: string[] = []
    let stderrPartial = ""

    // Inject the prompt-injector plugin (carries the audio-friendly prompt
    // via plugin options) for opencode spawns only. For other cliKinds
    // (claude, gemini, codex) — env passes through unchanged.
    const envWithPlugin =
      input.cliKind === "opencode"
        ? {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(
              process.env.OPENCODE_CONFIG_CONTENT,
            ),
          }
        : process.env

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(cli.bin, [...cli.args], {
        cwd: input.cwd,
        env: envWithPlugin,
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch (err) {
      // Bun edge case: spawn throws synchronously on ENOENT
      childLog.warn({ err }, "spawn threw synchronously")
      throw err
    }

    // Register listeners immediately — before any async tick can emit error
    child.on("error", (err) => {
      const errnoErr = err as NodeJS.ErrnoException
      childLog.warn(
        { err: { message: err.message, code: errnoErr.code } },
        "child error event",
      )
      // If no pid → spawn failed; notify crash and remove from store
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

    if (!child.pid) {
      // Error event will handle cleanup separately. Return error to caller.
      throw new Error(`spawn returned no pid (bin=${cli.bin})`)
    }

    const handle: BridgeHandle = {
      bridgeId,
      cliKind: input.cliKind,
      cwd: input.cwd,
      port: 0, // in-process: no port. Field kept for backward compat.
      pid: child.pid,
      wsUrl: "", // in-process: no WS URL.
      startedAt: new Date(),
    }

    store.set(bridgeId, { handle, child, stderrLines })
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
      // Remove before exit event fires — prevents notifyCrash on intentional kill
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
  }
}
