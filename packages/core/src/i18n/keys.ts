/**
 * MessageKey — single source of truth for all UI strings.
 *
 * Adding a new string:
 *   1. Add the key here.
 *   2. Add the translation in catalogs/he.ts (required) and catalogs/en.ts (placeholder ok).
 *   3. Use via `t("your.key")`.
 *
 * NEVER inline Hebrew (or any UI text) in code. The lint script
 * `scripts/lint-no-hebrew-in-code.sh` enforces this.
 */

export type Locale = "he" | "en"

export const LOCALES: readonly Locale[] = ["he", "en"]

export type MessageKey =
  // Connect page (/)
  | "connect.title"
  | "connect.subtitle"
  | "connect.cli.label"
  | "connect.cwd.label"
  | "connect.cwd.placeholder"
  | "connect.submit"
  | "connect.submitting"
  | "connect.error.prefix"
  // Chat page (/chat)
  | "chat.bubble.user"
  | "chat.bubble.thought"
  | "chat.bubble.agent"
  | "chat.empty"
  | "chat.prompt.placeholder"
  | "chat.send"
  | "chat.disconnect"
  | "chat.audioToggle"

/**
 * MessageValue — string or function for parameterized messages.
 * Phase 1: only literal strings. If we need parameters later, change to:
 *   string | ((params: Record<string, string | number>) => string)
 */
export type MessageValue = string

export type Catalog = Record<MessageKey, MessageValue>
