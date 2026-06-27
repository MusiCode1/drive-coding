import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk"
import type { Result } from "neverthrow"
import type { Agent, CliKind, CreateAgentInput } from "./schemas"

export type { PromptResponse, SessionNotification }

/**
 * AgentRegistry — אחסון מופשט לאוסף של סוכנים.
 * Slice 2: Map בזיכרון.
 * Slice 3+: יוסיף קישור ל-BridgeHandle.
 * [עתיד]: אם נוסיף זהות, נוסיף ownerId.
 */
export interface AgentRegistry {
  /** יוצר סוכן חדש. ב-Slice 2 stub status='ready' ישר. */
  create(input: CreateAgentInput): Promise<Agent>

  /** מחזיר סוכן לפי id, או null אם לא קיים. */
  get(id: string): Promise<Agent | null>

  /** רשימת כל הסוכנים (ללא סינון — אין זהות ב-MVP). */
  list(): Promise<ReadonlyArray<Agent>>

  /** עדכון סטטוס / פרטי bridge / סיבת קריסה / נעיצה. זורק שגיאה אם id לא קיים. */
  update(
    id: string,
    patch: Partial<Pick<Agent, "status" | "bridgePort" | "acpSessionId" | "crashReason" | "persistent">>,
  ): Promise<Agent>

  /** הסרה. זורק שגיאה אם לא קיים. */
  delete(id: string): Promise<void>
}

// ─── ACP Transport (Slice 4) ──────────────────────────────────
// הערה: BridgeKind, SpawnBridgeInput, BridgeHandle, BridgeManager עברו ל-@drive-coding/provider/spawn (R2)

export type AcpCapabilities = {
  readonly loadSession: boolean
}

export type AcpError =
  | { readonly kind: "transport"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }
  | { readonly kind: "agent"; readonly message: string }

export interface AcpTransport {
  /** חיבור + אתחול + session/new. */
  start(input: { readonly cwd: string }): Promise<{
    readonly sessionId: string
    readonly capabilities: AcpCapabilities
  }>

  /** שליחת פרומפט. onUpdate נקראת עבור כל הודעת session/update. */
  prompt(
    input: { readonly text: string },
    onUpdate: (n: SessionNotification) => void,
  ): Promise<PromptResponse>

  /** ביטול פרומפט בתהליך. */
  cancel(): Promise<void>

  /** ניתוק WS, השארת ה-bridge חי. */
  shutdown(): Promise<void>
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
