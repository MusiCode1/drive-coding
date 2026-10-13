/**
 * scope-prompt.ts — pure display helpers for cross-session scope escalation prompts.
 */

/** Branded _meta key. Do not change — FE reads it. */
export const SCOPE_PROMPT_META_KEY = "drive-coding/scope"

/** Agent subset used for scope prompt labels (not full Agent). */
export type ScopePartyInfo = {
  id: string
  cliKind?: string
  cwd?: string
  title?: string | null
  roleLabel?: string
}

export type ScopePromptDetail = {
  /** Display label for caller — never a raw full UUID. */
  caller: string
  /** Display label for target — never a raw full UUID. */
  target: string
  /** Raw verb from the write surface; translation lives in FE. */
  verb: string
  callerShortId: string
  targetShortId: string
  /** epoch-ms of automatic rejection. undefined = no timeout shown. */
  expiresAtMs?: number
}

/** First 6 chars of id; shorter ids returned as-is. */
export function shortAgentId(id: string): string {
  return id.length <= 6 ? id : id.slice(0, 6)
}

function basenameCwd(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

function nonEmptyString(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

/**
 * Preference: roleLabel → title → `<cliKind> · <basename(cwd)>` → `<cliKind>` → shortId.
 * Never returns the full id string.
 */
export function describeScopeParty(party: ScopePartyInfo): string {
  const role = nonEmptyString(party.roleLabel)
  if (role) return role
  const title = nonEmptyString(party.title ?? undefined)
  if (title) return title
  const cli = nonEmptyString(party.cliKind)
  const cwd = nonEmptyString(party.cwd)
  if (cli && cwd) return `${cli} · ${basenameCwd(cwd)}`
  if (cli) return cli
  return shortAgentId(party.id)
}

function partyFromAgents(id: string, agents: readonly ScopePartyInfo[]): ScopePartyInfo {
  const found = agents.find((a) => a.id === id)
  return found ?? { id }
}

/** Builds detail from both sides; missing agent rows fall back to id-only party info. */
export function buildScopePromptDetail(opts: {
  callerId: string
  targetId: string
  verb: string
  agents: readonly ScopePartyInfo[]
}): ScopePromptDetail {
  const callerParty = partyFromAgents(opts.callerId, opts.agents)
  const targetParty = partyFromAgents(opts.targetId, opts.agents)
  return {
    caller: describeScopeParty(callerParty),
    target: describeScopeParty(targetParty),
    verb: opts.verb,
    callerShortId: shortAgentId(opts.callerId),
    targetShortId: shortAgentId(opts.targetId),
  }
}

/**
 * Fallback title for toolCall.title — English only (BE has no FE locale; lint:i18n).
 * Shown only when _meta did not reach the client.
 */
export function formatScopePromptTitle(detail: ScopePromptDetail): string {
  return `${detail.caller} requests ${detail.verb} on ${detail.target}`
}
