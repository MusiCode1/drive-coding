<script lang="ts">
/**
 * /chat/[cliKind]/[sessionId]/resume — deep link: bring an existing session back up.
 *
 * A separate route rather than a `?resume=1` flag, for the reason `/new` is separate:
 * this one *acts* (it may spawn a host), and a landing route can **replace** itself in
 * history once it has. A flag would stay in the live chat screen's address bar, where a
 * refresh would fire it again. The flow itself lives in `resume-deep-link.ts`.
 */
import { untrack } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { type ResumePhase, runResumeDeepLink } from "$lib/actions/resume-deep-link"
import { getCliAvailability, getI18n, getSession, getSettings } from "$lib/context"

const session = getSession()
const settings = getSettings()
const cliAvailability = getCliAvailability()
const t = getI18n().t

let phase = $state<ResumePhase>("starting")
let startedFor: string | null = null

function errorMessage(): string {
  if (phase === "unknown-cli") return t("deepLink.error.unknownCli")
  if (phase === "home-dir-failed") return t("deepLink.error.homeDir")
  if (phase === "not-in-history") return t("deepLink.resume.notInHistory")
  if (phase === "failed") return session.error ?? ""
  return ""
}

async function run(kind: string, sessionId: string, rawCwd: string | null, takeover: boolean) {
  const result = await runResumeDeepLink({
    cliKind: kind,
    sessionId,
    rawCwd,
    takeover,
    session,
    settings,
    cliAvailability,
  })

  if (page.params.cliKind !== kind || page.params.sessionId !== sessionId) return

  if (result.phase === "connected") {
    // Replace, so Back cannot land here again and re-run a spawn.
    await goto(result.target, { replaceState: true })
    return
  }
  phase = result.phase
}

$effect(() => {
  if (!page.url.pathname.endsWith("/resume")) return

  const kind = page.params.cliKind
  const sessionId = page.params.sessionId
  if (!kind || !sessionId) return
  const rawCwd = page.url.searchParams.get("cwd")
  const key = `${kind}|${sessionId}|${rawCwd}`
  if (startedFor === key) return
  startedFor = key

  phase = "starting"
  untrack(() => void run(kind, sessionId, rawCwd, false))
})

async function confirmTakeover() {
  const kind = page.params.cliKind
  const sessionId = page.params.sessionId
  if (!kind || !sessionId) return
  phase = "starting"
  await run(kind, sessionId, page.url.searchParams.get("cwd"), true)
}

function goHome() {
  goto("/")
}
</script>

{#if phase === "needs-takeover"}
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
{:else if phase === "starting"}
  <main class="min-h-dvh flex items-center justify-center p-6">
    <p class="text-sm text-[var(--fg-dim)]">{t("deepLink.resume.starting")}</p>
  </main>
{:else}
  <main class="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-lg font-medium">{t("deepLink.error.title")}</h1>
    <div class="error text-sm text-[var(--fg-dim)] max-w-md" role="alert">{errorMessage()}</div>
    <button
      type="button"
      class="px-4 py-2 rounded-lg border text-sm"
      style="border-color:var(--border)"
      onclick={goHome}
    >
      {t("deepLink.error.back")}
    </button>
  </main>
{/if}
