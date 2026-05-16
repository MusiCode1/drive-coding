import type { ChildProcess } from "node:child_process"
import type { BridgeHandle, BridgeManager, SpawnBridgeInput } from "@drive-coding/core"
import { spawnAndWaitForPort } from "./bridge-spawn.js"
import { buildStdioToWsArgs, getCliCommand } from "./cli-config.js"

type Entry = {
  readonly handle: BridgeHandle
  readonly child: ChildProcess
  /** Returns a snapshot of the last ≤200 stderr lines from the bridge process. */
  readonly getStderr: () => string[]
}

/** Extended handle with stderr access — used internally by orchestrator. */
export type BridgeHandleWithStderr = BridgeHandle & {
  readonly getStderr: () => string[]
}

export function createBridgeManager(): BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
} {
  const store = new Map<string, Entry>()
  const crashHandlers = new Set<(bridgeId: string, exitCode: number | null) => void>()

  function notifyCrash(bridgeId: string, exitCode: number | null): void {
    for (const handler of crashHandlers) {
      try {
        handler(bridgeId, exitCode)
      } catch (e) {
        console.error("[bridge-manager] crash handler threw:", e)
      }
    }
  }

  async function spawnInternal(
    bridgeId: string,
    input: SpawnBridgeInput,
  ): Promise<BridgeHandleWithStderr> {
    if (store.has(bridgeId)) {
      throw new Error(`Bridge ${bridgeId} already exists`)
    }

    const cli = getCliCommand(input.cliKind, input.modelOverride)
    // Use a random port in ephemeral range (stdio-to-ws doesn't support port=0 / OS-assigned)
    const randomPort = 40000 + Math.floor(Math.random() * 20000)
    const args = buildStdioToWsArgs(cli, randomPort)

    // Use npx by default (universal Node+Bun per D45)
    const bin = "npx"

    const result = await spawnAndWaitForPort({
      bin,
      args,
      cwd: input.cwd,
      portTimeoutMs: 30000,
    })

    const handle: BridgeHandle = {
      bridgeId,
      cliKind: input.cliKind,
      cwd: input.cwd,
      port: result.port,
      pid: result.pid,
      wsUrl: `ws://127.0.0.1:${result.port}/`,
      startedAt: new Date(),
    }

    const entry: Entry = {
      handle,
      child: result.child,
      getStderr: result.getStderr,
    }

    store.set(bridgeId, entry)

    // Crash listener — only notifies for unexpected exits (not when we kill it)
    result.child.on("exit", (code) => {
      if (store.has(bridgeId)) {
        store.delete(bridgeId)
        notifyCrash(bridgeId, code)
      }
    })

    return { ...handle, getStderr: result.getStderr }
  }

  return {
    // Extended method with stderr access
    async spawnWithStderr(
      bridgeId: string,
      input: SpawnBridgeInput,
    ): Promise<BridgeHandleWithStderr> {
      return spawnInternal(bridgeId, input)
    },

    // Standard BridgeManager interface — delegates to internal
    async spawn(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandle> {
      return spawnInternal(bridgeId, input)
    },

    get(bridgeId: string): BridgeHandle | null {
      return store.get(bridgeId)?.handle ?? null
    },

    list(): ReadonlyArray<BridgeHandle> {
      return [...store.values()].map((e) => e.handle)
    },

    async kill(bridgeId: string): Promise<boolean> {
      const entry = store.get(bridgeId)
      if (!entry) return false

      // Mark as removed before exit event fires, to avoid notifyCrash
      store.delete(bridgeId)

      return new Promise((resolve) => {
        const onExit = () => {
          resolve(true)
        }
        entry.child.once("exit", onExit)
        entry.child.kill("SIGTERM")

        // Force kill after 5s
        setTimeout(() => {
          entry.child.kill("SIGKILL")
        }, 5000)
      })
    },

    onCrash(handler) {
      crashHandlers.add(handler)
      return () => {
        crashHandlers.delete(handler)
      }
    },
  }
}
