<script lang="ts">
/**
 * /chat/[cliKind]/[sessionId] — cold entry without idle guard.
 */
import { untrack } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { type OpenSessionOutcome, openSessionUrl } from "$lib/actions/open-session-url"
import AuthGuidance from "$lib/components/AuthGuidance.svelte"
import ChatScreen from "$lib/components/chat/ChatScreen.svelte"
import { getI18n, getSession, getSettings } from "$lib/context"
import { sessionPathWithTransport } from "$lib/session/session-url"

const session = getSession()
const settings = getSettings()
const t = getI18n().t

let outcome = $state<OpenSessionOutcome | "resolving">("resolving")

async function resolve(cliKind: string, sessionId: string) {
  const requestedKind = cliKind
  const requestedId = sessionId

  const result = await openSessionUrl({
    cliKind,
    sessionId,
    session,
    settings,
  })

  if (page.params.cliKind !== requestedKind || page.params.sessionId !== requestedId) return

  outcome = result
}

$effect(() => {
  const kind = page.params.cliKind
  const sid = page.params.sessionId
  if (!kind || !sid) {
    outcome = "not-found"
    return
  }
  outcome = "resolving"
  untrack(() => void resolve(kind, sid))
})

function goHome() {
  goto("/")
}

function goBack() {
  if (session.sessionId !== null && session.cliKind) {
    goto(sessionPathWithTransport(session.cliKind, session.sessionId, session.sessionTransport))
    return
  }
  goto("/")
}
</script>

{#if outcome === "connected"}
  <ChatScreen />
{:else if outcome === "busy"}
  <main class="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-lg font-medium">{t("sessionUrl.busy.title")}</h1>
    <p class="text-sm text-[var(--fg-dim)] max-w-md">{t("sessionUrl.busy.body")}</p>
    <button
      type="button"
      class="px-4 py-2 rounded-lg border text-sm"
      style="border-color:var(--border)"
      onclick={goBack}
    >
      {t("sessionUrl.busy.back")}
    </button>
  </main>
{:else if outcome === "not-found" || outcome === "error"}
  <main class="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
    {#if outcome === "error" && session.error && session.authMethods.length > 0}
      <h1 class="text-lg font-medium" role="alert" dir="auto">{session.error}</h1>
      <AuthGuidance cliKind={session.cliKind} authMethods={session.authMethods} />
    {:else}
      <h1 class="text-lg font-medium">{t("sessionUrl.notFound.title")}</h1>
      <p class="text-sm text-[var(--fg-dim)] max-w-md">{t("sessionUrl.notFound.body")}</p>
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
