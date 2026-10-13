/**
 * layout-session-wiring.svelte.ts — composition-root effects for session-adjacent wiring.
 */

import type { Locale } from "@drive-coding/core/i18n"
import { page } from "$app/state"
import { setSessionScopePolicy } from "$lib/context"
import { normalizeSessionTransport } from "$lib/session/session-transport"
import type { AgentSession } from "../view-models/agent-session.svelte"
import type { I18nVM } from "../view-models/i18n.svelte"
import type { PresencePoller } from "../view-models/presence-poller.svelte"
import { SessionScopePolicy } from "../view-models/session-scope-policy.svelte"
import type { Settings } from "../view-models/settings.svelte"
import type { UiShellVM } from "../view-models/ui-shell.svelte"
import { isPageHidden } from "../util/page-visibility.svelte"

const RTL_LOCALES: Locale[] = ["he"]

export function installSessionScopePolicy(deps: {
  session: AgentSession
  settings: Settings
}): void {
  const vm = new SessionScopePolicy(
    () => deps.session.agentId,
    () => deps.settings.beUrl,
  )
  setSessionScopePolicy(vm)
  $effect(() => {
    deps.settings.beUrl
    vm.noteBeUrlChanged()
  })
  $effect(() => {
    vm.syncAgent(deps.session.agentId)
  })
}

export function wireDocumentLocale(i18n: I18nVM): void {
  $effect(() => {
    const loc = i18n.locale
    const dir = RTL_LOCALES.includes(loc) ? "rtl" : "ltr"
    document.documentElement.dir = dir
    document.documentElement.lang = loc
  })
}

export function wireSessionTransportOverride(): void {
  $effect(() => {
    const q = page.url.searchParams.get("sessionTransport")
    const normalized = normalizeSessionTransport(q)
    if (normalized) sessionStorage.setItem("sessionTransport", normalized)
  })
}

export function wirePresencePoller(presencePoller: PresencePoller, session: AgentSession): void {
  $effect(() => {
    const status = session.status
    const inSession = status === "connected" || status === "disconnected"
    const agentId = session.agentId
    const hidden = isPageHidden()
    presencePoller.sync({ inSession, agentId, hidden })
  })
  $effect(() => () => presencePoller.dispose())
}

export function wireUiShellCloseOnAttach(uiShell: UiShellVM, session: AgentSession): void {
  $effect(() => {
    const agentId = session.agentId
    if (agentId) uiShell.closeSheet()
  })
}
