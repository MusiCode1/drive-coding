import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk"
import type { Result } from "neverthrow"
import type { Agent, CreateAgentInput } from "./schemas"
import type { BridgeCrashInfo } from "./acp/describe-crash.js"

export type { BridgeCrashInfo }

export type { PromptResponse, SessionNotification }

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

  /** עדכון status / bridge details / crashReason. throw אם id לא קיים. */
  update(
    id: string,
    patch: Partial<Pick<Agent, "status" | "bridgePort" | "acpSessionId" | "crashReason">>,
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
// ─── ACP Transport (Slice 4) ──────────────────────────────────

export type AcpCapabilities = {
  readonly loadSession: boolean
}

export type AcpError =
  | { readonly kind: "transport"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }
  | { readonly kind: "agent"; readonly message: string }

export interface AcpTransport {
  /** Connect + initialize + session/new. */
  start(input: { readonly cwd: string }): Promise<{
    readonly sessionId: string
    readonly capabilities: AcpCapabilities
  }>

  /** Send prompt. onUpdate is called for each session/update notification. */
  prompt(
    input: { readonly text: string },
    onUpdate: (n: SessionNotification) => void,
  ): Promise<PromptResponse>

  /** Cancel in-flight prompt. */
  cancel(): Promise<void>

  /** Disconnect WS, leave the bridge alive. */
  shutdown(): Promise<void>
}

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
  onCrash(handler: (bridgeId: string, info: BridgeCrashInfo) => void): () => void
}

// ─── Voice ports (Slice 5) ────────────────────────────────────

export type VoiceError =
  | { readonly kind: "stt_failed"; readonly message: string }
  | { readonly kind: "tts_failed"; readonly message: string }
  | { readonly kind: "translation_failed"; readonly message: string }
  | { readonly kind: "cache_error"; readonly message: string }

export interface SttPort {
  transcribe(
    audioBytes: Uint8Array,
    mimeType: string,
    options?: { previousAssistantText?: string },
  ): Promise<Result<{ text: string }, VoiceError>>
}

export interface TtsPort {
  synthesize(text: string, voiceId: string): Promise<Result<{ mp3Bytes: Uint8Array }, VoiceError>>
}

export interface TranslatorPort {
  translate(text: string, targetLang: "he" | "en"): Promise<Result<{ text: string }, VoiceError>>
}

export interface CacheStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
}
