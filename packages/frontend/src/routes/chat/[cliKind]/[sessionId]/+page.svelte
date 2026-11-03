<script lang="ts">
/**
 * /chat/[cliKind]/[sessionId] — cold entry without idle guard.
 *
 * Attaches to a live host; it never resumes. The offer below only navigates to
 * `/resume`, so visiting this page cannot bring an agent up as a side effect.
 */
import { untrack } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import type { OpenSessionOutcome } from "$lib/actions/open-session-url"
import { resolveSessionScreen } from "$lib/actions/session-screen"
import type { SessionHistoryRow } from "$lib/adapters/session-history-api"
import ChatScreen from "$lib/components/chat/ChatScreen.svelte"
import SessionResumeOffer from "$lib/components/chat/SessionResumeOffer.svelte"
import { getI18n, getSession, getSettings } from "$lib/context"

const session = getSession()
const settings = getSettings()
const t = getI18n().t

const OWNED_AGENT_KEY = "dc.ownedAgentId"

let outcome = $state<OpenSessionOutcome | "resolving">("resolving")
let resumable = $state<SessionHistoryRow | null>(null)

async function resolve(cliKind: string, sessionId: string, confirmedTakeover = false) {
  const requestedKind = cliKind
  const requestedId = sessionId

  const screen = await resolveSessionScreen({
    cliKind,
    sessionId,
    session,
    settings,
    confirmedTakeover,
  })

  if (page.params.cliKind !== requestedKind || page.params.sessionId !== requestedId) return

  outcome = screen.outcome
  resumable = screen.resumable
  if (screen.outcome === "connected" && session.agentId) {
    sessionStorage.setItem(OWNED_AGENT_KEY, session.agentId)
  }
}

$effect(() => {
  const kind = page.params.cliKind
  const sid = page.params.sessionId
  if (!kind || !sid) {
    outcome = "not-found"
    return
  }
  outcome = "resolving"
  resumable = null
  untrack(() => void resolve(kind, sid))
})

function goResume() {
  const kind = page.params.cliKind
  const sid = page.params.sessionId
  if (!kind || !sid) return
  goto(`/chat/${encodeURIComponent(kind)}/${encodeURIComponent(sid)}/resume`)
}

async function confirmTakeover() {
  const kind = page.params.cliKind
  const sid = page.params.sessionId
  if (!kind || !sid) return
  outcome = "resolving"
  await resolve(kind, sid, true)
}

function goHome() {
  goto("/")
}
</script>

{#if outcome === "connected"}
  <ChatScreen />
{:else if outcome === "needs-takeover"}
  <main class="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-lg font-medium">{t("sessionUrl.takeover.title")}</h1>
    <p class="text-sm text-[var(--fg-dim)] max-w-md">{t("sessionUrl.takeover.body")}</p>
    <div class="flex gap-3">
      <button
        type="button"
        class="px-4 py-2 rounded-lg border text-sm"
        style="border-color:var(--border)"
        onclick={goHome}
      >
        {t("sessionUrl.takeover.cancel")}
      </button>
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm"
        style="background:var(--accent); color:var(--bg)"
        onclick={() => void confirmTakeover()}
      >
        {t("sessionUrl.takeover.confirm")}
      </button>
    </div>
  </main>
{:else if outcome === "not-found" || outcome === "error"}
  <main class="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-lg font-medium">{t("sessionUrl.notFound.title")}</h1>
    <p class="text-sm text-[var(--fg-dim)] max-w-md">{t("sessionUrl.notFound.body")}</p>
    {#if resumable}
      <SessionResumeOffer row={resumable} onResume={goResume} />
    {/if}
    <button
      type="button"
      class="px-4 py-2 rounded-lg border text-sm"
      style="border-color:var(--border)"
      onclick={goHome}
    >
      {t("sessionUrl.notFound.back")}
    </button>
  </main>
{:else}
  <main class="min-h-dvh flex items-center justify-center p-6">
    <p class="text-sm text-[var(--fg-dim)]">{t("sessionUrl.resolving")}</p>
  </main>
{/if}
