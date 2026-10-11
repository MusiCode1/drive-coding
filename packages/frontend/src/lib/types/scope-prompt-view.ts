import type { MessageKey } from "@drive-coding/core/i18n"
import {
  SCOPE_PROMPT_META_KEY,
  type ScopePromptDetail,
} from "@drive-coding/core/types/scope-prompt"
import type { PermissionParams } from "$lib/types/permission"

function isScopePromptDetail(value: unknown): value is ScopePromptDetail {
  if (!value || typeof value !== "object") return false
  const o = value as Record<string, unknown>
  return (
    typeof o.caller === "string" &&
    typeof o.target === "string" &&
    typeof o.verb === "string" &&
    typeof o.callerShortId === "string" &&
    typeof o.targetShortId === "string"
  )
}

/** Cross-session escalation prompt written by the backend (not agent tool titles). */
export function readScopePromptDetail(params: PermissionParams): ScopePromptDetail | null {
  const toolCallId = params.toolCall.toolCallId
  if (!toolCallId.startsWith("scope-")) return null
  const meta = params.toolCall._meta
  if (!meta || typeof meta !== "object") return null
  const raw = (meta as Record<string, unknown>)[SCOPE_PROMPT_META_KEY]
  if (!isScopePromptDetail(raw)) return null
  return raw
}

const VERB_KEYS: Record<string, MessageKey> = {
  close: "scopePrompt.verb.close",
  patch: "scopePrompt.verb.patch",
  reply: "scopePrompt.verb.reply",
  send: "scopePrompt.verb.send",
}

export type ScopeDetailRow = { label: string; value: string }

export function scopeDetailRows(
  detail: ScopePromptDetail,
  t: (key: MessageKey) => string,
): ScopeDetailRow[] {
  const verbKey = VERB_KEYS[detail.verb]
  const verbLabel = verbKey ? t(verbKey) : detail.verb
  return [
    {
      label: t("scopePrompt.caller"),
      value: `${detail.caller} (${detail.callerShortId})`,
    },
    {
      label: t("scopePrompt.target"),
      value: `${detail.target} (${detail.targetShortId})`,
    },
    { label: t("scopePrompt.action"), value: verbLabel },
  ]
}
