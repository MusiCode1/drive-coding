/**
 * spawn/types.ts — סוגי ה-spawn contract.
 *
 * מקור-האמת לסוגים אלה עבר מ-core/src/ports.ts ל-provider/spawn.
 * צרכנים (backend, frontend) מייבאים מ-@drive-coding/provider/spawn.
 *
 * BridgeKind = alias ל-CliKind מ-core (מקור-האמת נשאר ב-core/schemas).
 */
import type { CliKind } from "@drive-coding/core"

// BridgeKind = alias ל-CliKind. שם היסטורי (Slice 3) — נשמר לתאימות,
// אבל מקור-האמת היחיד הוא CLI_KINDS ב-schemas/agent.ts.
export type BridgeKind = CliKind

export type SpawnBridgeInput = {
  readonly cliKind: BridgeKind
  readonly cwd: string
  readonly modelOverride: string | null
}

export type BridgeHandle = {
  readonly bridgeId: string // UUID, זהה ל-agent id השייך לו
  readonly cliKind: BridgeKind
  readonly cwd: string
  readonly port: number // הוקצה על ידי מערכת ההפעלה, פוענח מ-stdout
  readonly pid: number // PID של תהליך ה-bridge
  readonly wsUrl: string // ws://127.0.0.1:<port>/
  readonly startedAt: Date
}

export interface BridgeManager {
  /** יוצר (spawn) תהליך bridge. */
  spawn(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandle>

  /** מקבל handle. null אם לא קיים. */
  get(bridgeId: string): BridgeHandle | null

  /** רשימה של bridges חיים. */
  list(): ReadonlyArray<BridgeHandle>

  /** חיסול עדין (kill graceful). מחזיר true אם נהרג, false אם לא קיים. */
  kill(bridgeId: string): Promise<boolean>

  /** מנוי (subscribe) לאירועי קריסה. callback נקרא כש-bridge מת לבד. */
  onCrash(handler: (bridgeId: string, info: BridgeCrashInfo) => void): () => void
}

import type { BridgeCrashInfo } from "./describe-crash.js"
export type { BridgeCrashInfo }
