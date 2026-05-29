/**
 * MessageKey — single source of truth for all UI strings.
 *
 * Adding a new string:
 *   1. Add the key to the appropriate `// ─── <domain> ───` block below.
 *      If no block matches, append a new block AT THE END of the union.
 *   2. Add the translation in catalogs/he.ts (required) and catalogs/en.ts
 *      (placeholder ok) — in the same domain block.
 *   3. Use via `t("your.key")`.
 *
 * NEVER inline Hebrew (or any UI text) in code. The lint script
 * `scripts/lint-no-hebrew-in-code.sh` enforces this.
 *
 * ─── Parallel-safe additive design (docs/conventions/parallel-safe-code.md) ───
 * Two slices that add keys land in different blocks → git auto-merge.
 */

export type Locale = "he" | "en"

export const LOCALES: readonly Locale[] = ["he", "en"]

export type MessageKey =
  // ─── connect ─── (slice 0)
  | "connect.title"
  | "connect.subtitle"
  | "connect.cli.label"
  | "connect.cwd.label"
  | "connect.cwd.placeholder"
  | "connect.submit"
  | "connect.submitting"
  | "connect.error.prefix"
  // ─── chat ─── (slice 0.5 + slice 2)
  | "chat.bubble.user"
  | "chat.bubble.thought"
  | "chat.bubble.agent"
  | "chat.empty"
  | "chat.prompt.placeholder"
  | "chat.send"
  | "chat.disconnect"
  | "chat.audioToggle"
  // ─── voice picker ─── (slice 9 — voice selection)
  | "chat.voicePicker.label"
  | "chat.voicePicker.loading"
  | "chat.voicePicker.error"
  // ─── mic ─── (slice 3)
  | "mic.error.permission"
  | "mic.error.notFound"
  | "mic.error.transcribe"
  | "mic.error.generic"
  // ─── voice-mode ─── (slice 3)
  // ─── tool-bubble ─── (slice 4)
  // ─── audio-cues ─── (slice 6)
  // ─── car-mode ─── (slice 7)
  // ─── sessions ─── (slice 8)
  // ─── settings ─── (slice 9)
  // ─── recordings ─── (slice 10)

/**
 * MessageValue — string or function for parameterized messages.
 * Phase 1: only literal strings. If we need parameters later, change to:
 *   string | ((params: Record<string, string | number>) => string)
 */
export type MessageValue = string

export type Catalog = Record<MessageKey, MessageValue>
