import type { Agent, CreateAgentInput } from "./schemas"

/**
 * AgentRegistry — abstract storage לcollection של agents.
 * Slice 2: in-memory Map.
 * Slice 3+: יוסיף קישור ל-BridgeHandle.
 * [future]: אם נוסיף identity, נוסיף ownerId.
 */
export interface AgentRegistry {
  /** יוצר agent חדש. ב-Slice 2 stub status='ready' ישר. */
  create(input: CreateAgentInput): Promise<Agent>

  /** מחזיר agent לפי id, או null אם לא קיים. */
  get(id: string): Promise<Agent | null>

  /** רשימת כל ה-agents (no filter — אין identity ב-MVP). */
  list(): Promise<ReadonlyArray<Agent>>

  /** עדכון status / bridge details. throw אם id לא קיים. */
  update(
    id: string,
    patch: Partial<Pick<Agent, "status" | "bridgePort" | "acpSessionId">>,
  ): Promise<Agent>

  /** הסרה. throw אם לא קיים. */
  delete(id: string): Promise<void>
}

// ─── חדש ב-Slice 3 ──────────────────────────────

export type BridgeKind = "opencode" | "claude" | "gemini" | "codex"

export type SpawnBridgeInput = {
  readonly cliKind: BridgeKind
  readonly cwd: string
  readonly modelOverride: string | null
}

export type BridgeHandle = {
  readonly bridgeId: string // UUID, אותו שייך לagent id
  readonly cliKind: BridgeKind
  readonly cwd: string
  readonly port: number // OS-assigned, parsed מ-stdout
  readonly pid: number // PID של תהליך ה-bridge
  readonly wsUrl: string // ws://127.0.0.1:<port>/
  readonly startedAt: Date
}

export type SpawnError =
  | { readonly kind: "cli_not_found"; readonly message: string }
  | { readonly kind: "spawn_failed"; readonly message: string }
  | { readonly kind: "port_parse_timeout"; readonly message: string }
  | { readonly kind: "unknown"; readonly message: string }

/**
 * BridgeManager — manages stdio-to-ws bridges per agent.
 * Each bridge wraps a CLI agent (opencode/claude/...) and exposes WS.
 * Bridges שורדים נפילת backend (--persist).
 * הregistry בזיכרון — נאבד ב-backend restart (D8).
 */
export interface BridgeManager {
  /** spawn `@rebornix/stdio-to-ws "<cli> acp" --port 0 --persist --grace-period -1`. */
  spawn(bridgeId: string, input: SpawnBridgeInput): Promise<BridgeHandle>

  /** מקבל handle. null אם לא קיים. */
  get(bridgeId: string): BridgeHandle | null

  /** רשימה של bridges חיים. */
  list(): ReadonlyArray<BridgeHandle>

  /** kill graceful — SIGTERM ל-stdio-to-ws (שיהרוג את ה-CLI). מחזיר true אם נהרג, false אם לא קיים. */
  kill(bridgeId: string): Promise<boolean>

  /** subscribe ל-crash events. callback נקרא כש-bridge מת לבד. */
  onCrash(handler: (bridgeId: string, exitCode: number | null) => void): () => void
}
