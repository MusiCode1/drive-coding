<script lang="ts">
/**
 * /chat/[cliKind]/new — deep link: new session from ?cwd= without the connect screen.
 */
import { untrack } from "svelte"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { connectAgent } from "$lib/actions/connect-agent"
import { fetchServerOptions } from "$lib/adapters/options"
import { getCliAvailability, getI18n, getSession, getSettings } from "$lib/context"
import { classifyDeepLinkCwd, joinHomeDir } from "$lib/util/deep-link-cwd"

type Phase = "starting" | "unknown-cli" | "home-dir-failed" | "spawn-failed"

const session = getSession()
const settings = getSettings()
const cliAvailability = getCliAvailability()
const t = getI18n().t

let phase = $state<Phase>("starting")
let startedFor: string | null = null

function errorMessage(): string {
  if (phase === "unknown-cli") return t("deepLink.error.unknownCli")
  if (phase === "home-dir-failed") return t("deepLink.error.homeDir")
  if (phase === "spawn-failed") return session.error ?? ""
  return ""
}

async function resolveNew(kind: string, raw: string | null) {
  await cliAvailability.ready

  if (!cliAvailability.registry.includes(kind)) {
    phase = "unknown-cli"
    return
  }

  const classified = classifyDeepLinkCwd(raw)
  if (classified.kind === "empty") {
    settings.setCliKind(kind)
    await goto("/", { replaceState: true })
    return
  }

  let cwd: string
  if (classified.kind === "absolute") {
    cwd = classified.cwd
  } else {
    try {
      const { homeDir } = await fetchServerOptions()
      cwd = joinHomeDir(homeDir, classified.relative)
    } catch {
      phase = "home-dir-failed"
      return
    }
  }

  if (session.status !== "idle") {
    await session.leaveRunning()
  }

  await connectAgent({
    cliKind: kind,
    cwd,
    session,
    settings,
    navigate: "replace",
  })

  if (session.error !== null) {
    phase = "spawn-failed"
  }
}

$effect(() => {
  if (!page.url.pathname.endsWith("/new")) return

  const kind = page.params.cliKind
  if (!kind) return
  const raw = page.url.searchParams.get("cwd")
  const key = `${kind}|${raw}`
  if (startedFor === key) return
  startedFor = key

  phase = "starting"
  untrack(() => void resolveNew(kind, raw))
})

function goHome() {
  goto("/")
}
</script>

{#if phase === "unknown-cli" || phase === "home-dir-failed" || phase === "spawn-failed"}
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
{:else}
  <main class="min-h-dvh flex items-center justify-center p-6">
    <p class="text-sm text-[var(--fg-dim)]">{t("deepLink.new.starting")}</p>
  </main>
{/if}
