import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { BridgeCrashInfo, BridgeHandle, BridgeManager, SpawnBridgeInput } from "@drive-coding/provider/spawn"
import { createLogger } from "@drive-coding/core/log"
import { buildOpencodeConfigContent } from "../plugin-config.js"
import { AUDIO_FRIENDLY_PROMPT } from "../prompts/index.js"
import { decodeWireLine } from "../delivery/wire-decode.js"
import type { WireRecorder, WireSession } from "../delivery/wire-recorder.js"
import { type TurnTracker, createTurnTracker } from "./turn-tracker.js"
import { getCliCommand, getCliSpec } from "@drive-coding/provider/config"

const log = createLogger("backend.bridge.manager")
const wireLog = createLogger("backend.acp.wire")
const STDERR_MAX_LINES = 200

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
  const wireRecorder = opts?.wireRecorder

  type Entry = {
    handle: BridgeHandle
    child: ChildProcessWithoutNullStreams
    stderrLines: string[]
    // ─── תצוגת active-agents (attached) — משרת getRuntimeInfo ───
    hasActiveWs: boolean
    // ─── slice agent-busy-indicator: tracker + subscribers לשורות stdout ───
    tracker: TurnTracker
    lineSubscribers: Set<(line: string) => void>
    // ─── wire observability: recording session לכל חיי ה-child ───
    rec: WireSession
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
        store.get(bridgeId)?.rec.close()
        store.delete(bridgeId)
        notifyCrash(bridgeId, { exitCode: code, signal: signal ?? null })
      }
    })

    // ─── reader קבוע ל-stdout (slice agent-busy-indicator) ─────────────────────
    // bridge-manager הוא הבעלים היחיד של child.stdout. ws-agent נרשם ל-onLine
    // ומקבל את השורות דרך callback — לא קורא את ה-stream ישירות.
    // סדר חובה: subscribers (→ feWs.send) לפני decode/observe.
    child.stdout.setEncoding("utf8")
    const stdoutRl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    stdoutRl.on("line", (line) => {
      const entry = store.get(bridgeId)
      if (!entry) return
      // (1) שלח לכל ה-subscribers (ws-agent → feWs.send) לפני כל דבר אחר
      for (const cb of entry.lineSubscribers) {
        try { cb(line) } catch { /* subscriber לא יכול לשבור את הpipe */ }
      }
      // (2) wire observability (in) + decode + observe — non-critical, מבודד ב-try/catch
      // decode פעם אחת משמש גם את wireLog וגם את tracker.observe
      try {
        const s = decodeWireLine(line)
        const type = s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
        wireLog.debug({ bridgeId, dir: "in", type, id: s.id }, "wire")
        if (!s.unparsed) wireLog.trace({ bridgeId, dir: "in", frame: s.parsed }, "wire-full")
        entry.tracker.observe(s, Date.now())
      } catch { /* silent */ }
      entry.rec.record("in", line)
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

    // wire recording: קובץ רציף לכל חיי ה-child (no-op כש-WIRE_RECORD כבוי)
    const rec = wireRecorder?.open(bridgeId) ?? { record() {}, close() {} }

    store.set(bridgeId, {
      handle,
      child,
      stderrLines,
      // ─── תצוגת active-agents (attached) — משרת getRuntimeInfo ───
      hasActiveWs: false,
      // ─── slice agent-busy-indicator: tracker + subscribers לשורות stdout ───
      tracker: createTurnTracker(),
      lineSubscribers: new Set(),
      // ─── wire observability ───
      rec,
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
      // סגירת recording session לפני הסרה מהstore (idempotent)
      entry.rec.close()
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

    // ─── תצוגת active-agents (attached) ───
    // markAttached/markDetached משרתים את getRuntimeInfo (שדה attached) בתצוגת פאנל active-agents.
    // אינם זמניים — נחוצים לתצוגה השוטפת.
    markAttached(bridgeId: string) {
      const e = store.get(bridgeId)
      if (e) e.hasActiveWs = true
    },

    markDetached(bridgeId: string) {
      const e = store.get(bridgeId)
      if (e) e.hasActiveWs = false
    },

    // slice active-agents + agent-busy-indicator: returns { pid, attached, busy } for a live bridge, or null
    getRuntimeInfo(bridgeId: string): { pid: number; attached: boolean; busy: boolean } | null {
      const e = store.get(bridgeId)
      if (!e) return null
      return { pid: e.handle.pid, attached: e.hasActiveWs, busy: e.tracker.isBusy(Date.now()) }
    },

    // slice agent-busy-indicator: subscribe לשורות stdout (reader קבוע ב-bridge-manager)
    onLine(bridgeId: string, cb: (line: string) => void): () => void {
      const e = store.get(bridgeId)
      if (!e) return () => {}
      e.lineSubscribers.add(cb)
      return () => { e.lineSubscribers.delete(cb) }
    },

    // כותב שורה ל-child.stdin ומתעד את כיוון ה-out. מחזיר false אם ה-bridge לא קיים.
    writeStdin(bridgeId: string, line: string): boolean {
      const entry = store.get(bridgeId)
      if (!entry) return false
      entry.child.stdin.write(line)
      try {
        const raw = line.endsWith("\n") ? line.slice(0, -1) : line
        const s = decodeWireLine(raw)
        const type = s.sessionUpdate ?? s.method ?? s.responseKind ?? (s.unparsed ? "unparsed" : "unknown")
        wireLog.debug({ bridgeId, dir: "out", type, id: s.id }, "wire")
        if (!s.unparsed) wireLog.trace({ bridgeId, dir: "out", frame: s.parsed }, "wire-full")
      } catch { /* silent */ }
      entry.rec.record("out", line.endsWith("\n") ? line.slice(0, -1) : line)
      return true
    },
  }
}
