import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import type { BridgeCrashInfo, BridgeHandle, BridgeManager, SpawnBridgeInput } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { buildOpencodeConfigContent } from "../plugin-config.js"
import { AUDIO_FRIENDLY_PROMPT } from "../prompts/index.js"
import { getCliCommand, getCliSpec } from "./cli-config.js"

const log = createLogger("backend.bridge.manager")
const STDERR_MAX_LINES = 200

/** Handle מורחב עם גישה ל-stderr ו-child ישיר — משמש פנימית את ה-orchestrator. */
export type BridgeHandleWithStderr = BridgeHandle & {
  readonly getStderr: () => string[]
  readonly child: ChildProcessWithoutNullStreams
}

export function createBridgeManager(): BridgeManager & {
  spawnWithStderr(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandleWithStderr>
  getChild(bridgeId: string): ChildProcessWithoutNullStreams | null
  // ─── TEMPORARY (slice 26) ───
  markAttached(bridgeId: string): void
  markDetached(bridgeId: string): void
  listIdle(timeoutMs: number, now: number): string[]
  getCreatedAt(bridgeId: string): number | null   // TEMPORARY (fix-idle-flaky)
  // slice active-agents: runtime enrichment for GET /api/agents
  getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean } | null
} {
  type Entry = {
    handle: BridgeHandle
    child: ChildProcessWithoutNullStreams
    stderrLines: string[]
    // ─── TEMPORARY (slice 26) — idle-reaper tracking ───
    hasActiveWs: boolean
    lastDetachedAt: number | null
    createdAt: number
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

    // מזריק את הפלאגין prompt-injector רק עבור הפעלות של opencode.
    // Commit 3 (windows-adaptation): plugin רשום כ-string-URL (opencode 1.2.27 compat).
    // הטקסט מועבר דרך PROMPT_INJECTOR_TEXT — prompt-injector.ts קורא אותו כ-fallback.
    // עבור cliKinds אחרים (claude, gemini, codex) — ה-env עובר ללא שינוי.
    const envWithPlugin =
      input.cliKind === "opencode"
        ? {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: buildOpencodeConfigContent(
              process.env.OPENCODE_CONFIG_CONTENT,
            ),
            // העברת הטקסט לפלאגין דרך env (במקום options — opencode 1.2.27 לא מקבל tuple).
            PROMPT_INJECTOR_TEXT: AUDIO_FRIENDLY_PROMPT,
          }
        : { ...process.env }

    // env shaping לפי קובץ override (cli-specs.jsonc):
    // unsetEnv מסיר משתני proxy/CA (למשל עבור gemini תחת OneCLI).
    // setEnv מוסיף/דורס משתנים נוספים.
    // הסדר: envWithPlugin (כולל OPENCODE_CONFIG_CONTENT) → unsetEnv → setEnv.
    const spec = getCliSpec(input.cliKind, process.env)
    const childEnv: NodeJS.ProcessEnv = { ...envWithPlugin }
    for (const key of spec?.unsetEnv ?? []) {
      delete childEnv[key]
    }
    if (spec?.setEnv) {
      Object.assign(childEnv, spec.setEnv)
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(cli.bin, [...cli.args], {
        cwd: input.cwd,
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch (err) {
      // מקרה קצה ב-Bun: הפונקציה spawn זורקת שגיאה סינכרונית על ENOENT
      childLog.warn({ err }, "spawn threw synchronously")
      throw err
    }

    // רישום מאזינים באופן מיידי — לפני שאיזשהו async tick יכול לפלוט שגיאה
    child.on("error", (err) => {
      const errnoErr = err as NodeJS.ErrnoException
      childLog.warn(
        { err: { message: err.message, code: errnoErr.code } },
        "child error event",
      )
      // אם אין pid → ה-spawn נכשל; מודיע על התרסקות ומסיר מהמאגר
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
      // אירוע Error יטפל בניקוי בנפרד. מחזיר שגיאה לקורא.
      throw new Error(`spawn returned no pid (bin=${cli.bin})`)
    }

    const handle: BridgeHandle = {
      bridgeId,
      cliKind: input.cliKind,
      cwd: input.cwd,
      port: 0, // in-process: ללא פורט. השדה נשמר לתאימות לאחור.
      pid: child.pid,
      wsUrl: "", // in-process: ללא כתובת WS.
      startedAt: new Date(),
    }

    store.set(bridgeId, {
      handle,
      child,
      stderrLines,
      // ─── TEMPORARY (slice 26) — idle-reaper tracking ───
      hasActiveWs: false,
      lastDetachedAt: null,
      createdAt: Date.now(),
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
      // הסרה לפני שאירוע ה-exit נורה — מונע notifyCrash בהריגה מכוונת
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

    // ─── TEMPORARY (slice 26): idle-reaper support ───
    // Remove together with this whole block when background-agent management
    // (future "slice A") lands. See docs/plans/slice-26-bridge-idle-reaper.md §7.
    markAttached(bridgeId: string) {
      const e = store.get(bridgeId)
      if (e) e.hasActiveWs = true
    },

    markDetached(bridgeId: string) {
      const e = store.get(bridgeId)
      if (e) {
        e.hasActiveWs = false
        e.lastDetachedAt = Date.now()
      }
    },

    listIdle(timeoutMs: number, now: number): string[] {
      const out: string[] = []
      for (const [id, e] of store) {
        if (e.hasActiveWs) continue // active WS — never reap
        if (e.lastDetachedAt !== null) {
          if (now - e.lastDetachedAt >= timeoutMs) out.push(id)
        } else {
          // Never had a WS — grace period: 2x timeout before reaping
          if (now - e.createdAt >= timeoutMs * 2) out.push(id)
        }
      }
      return out
    },

    getCreatedAt(bridgeId: string): number | null {
      return store.get(bridgeId)?.createdAt ?? null
    },

    // slice active-agents: returns { pid, attached } for a live bridge, or null
    getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean } | null {
      const e = store.get(bridgeId)
      if (!e) return null
      return { pid: e.handle.pid, attached: e.hasActiveWs }
    },
  }
}
