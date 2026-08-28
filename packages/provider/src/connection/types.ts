/**
 * connection/types.ts — ProviderConnection primitive types (CUT-3b-i).
 *
 * ProviderConnection = פרימיטיב חיבור-ספק שחושף wire-stream (onLine-style) + onFrame
 * (decoded WireFrame) + turn + onCrash + capabilities + ext.
 *
 * wire: onLine-style (לא ReadableStream) — תואם ל-ws-agent.ts:86 ול-spawn-core.onLine.
 * ext: undefined ל-spawn-native; יוגדר לחיבורים in-process (CUT-3b-iii+).
 */

import type { BridgeCrashInfo, SpawnBridgeInput } from "../spawn/index.js"
import type { NormalizedCapabilities } from "../types.js"

/**
 * WireFrame — עטיפת פריים מפוענח עם dir + type נגזר + raw.
 * נגזר מ-WireSummary (wire-decode) — לא זהה; WireSummary = פלט גולמי של decodeWireLine,
 * WireFrame = העטיפה שה-primitive חושף לצרכניו.
 */
export interface WireFrame {
  dir: "in" | "out"
  /** type נגזר: sessionUpdate ?? method ?? responseKind ?? ("unparsed" | "unknown") */
  type: string
  id?: string | number
  raw: string
  parsed: unknown
}

/**
 * ConnectOpts — אפשרויות ל-connectSpawn.
 */
export interface ConnectOpts {
  cwd: string
  /**
   * modelOverride — model flag to pass to the CLI (e.g. "--model claude-opus-4-5").
   * null or undefined = use CLI default.
   * Without this field, the FE model-picker silently breaks (🔴 avigail finding).
   */
  modelOverride?: string | null
  /**
   * shapeEnv — hook for spawn-path env injection (opencode config, etc.).
   * **Spawn-only** — in-process bridges (claude, codex) ignore this; they use
   * `agentEnv` via `_meta.claudeCode.options.env` (claude) or have no env channel (codex).
   */
  shapeEnv?: (cliKind: SpawnBridgeInput["cliKind"], base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
  /**
   * agentEnv — per-agent env keys (e.g. DRIVE_CODING_AGENT_ID) for in-process bridges.
   * Spawn path receives the same keys through `shapeEnv` instead.
   */
  agentEnv?: Record<string, string>
  /**
   * systemPrompt — פרומפט-מערכת פר-פרויקט, טקסט חופשי שמתווסף (append) להוראות ברירת-המחדל
   * של הסוכן. גנרי כאן (string) — הצורה הספציפית-לספק (`_meta.systemPrompt` לקלוד,
   * `config.developer_instructions` ל-codex) נכתבת רק בקובץ-הספק (slice project-system-prompt §3).
   * null/undefined = ללא הזרקה. ספקים שלא קוראים את השדה (opencode/spawn) מתעלמים בשקט.
   */
  systemPrompt?: string | null
}

/**
 * ProviderConnection — פרימיטיב חיבור-ספק.
 *
 * wire: onLine-style לצריכת stdout מ-spawned process.
 *   - onLine(cb): subscribe לשורות גולמיות מה-child stdout. מחזיר unsubscribe.
 *   - write(line): כתוב שורה ל-child stdin.
 * onFrame: subscribe לפריימים מפוענחים (Variant A — מחזיר WireFrame).
 * turn: pull-based busy indicator (debounce-based, מ-turn-tracker).
 * onCrash: subscribe לקריסת ה-child.
 * close: הרוג את ה-child (graceful).
 * ext: undefined ל-spawn-native; channel להרחבות in-process בעתיד.
 * pid: PID של ה-child, או null אם לא זמין.
 */
export interface ProviderConnection {
  /**
   * wire — onLine-style stream (תואם ws-agent.ts:86).
   * לא ReadableStream — הכרעה מ-§9#1 (אביגיל אימתה vs spawn-core + ws-agent).
   */
  readonly wire: {
    onLine(cb: (line: string) => void): () => void
    write(line: string): boolean
  }

  readonly capabilities: NormalizedCapabilities

  /** subscribe לפריימים מפוענחים (Variant A). מחזיר unsubscribe. */
  onFrame(cb: (f: WireFrame) => void): () => void

  /** turn — pull-based busy indicator (debounce). */
  readonly turn: {
    isBusy(): boolean
    lastActivityAt(): number | null
    /** subscribe לשינויי busy-state. מחזיר unsubscribe. */
    onChange(cb: (busy: boolean) => void): () => void
  }

  /** subscribe לקריסת ה-child. מחזיר unsubscribe. */
  onCrash(cb: (info: BridgeCrashInfo) => void): () => void

  close(): Promise<void>

  /**
   * ext — channel להרחבות ספק-ספציפיות (in-process בלבד).
   * undefined ל-connectSpawn (spawn-native אין ext channel).
   */
  readonly ext?: { call(method: string, params: unknown): Promise<unknown> }

  /** PID של ה-child; null אם הסתיים או לא זמין. */
  readonly pid: number | null
}
