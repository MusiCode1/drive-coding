<script lang="ts">
import { getI18n, getSettings } from "$lib/context"
import AppShell from "$lib/components/layout/AppShell.svelte"

const settings = getSettings()
const t = getI18n().t

let beUrlInput = $state(settings.beUrl)
let error = $state<string | undefined>(undefined)
let savedAt = $state<number | undefined>(undefined)

function handleSave() {
  const result = settings.setBeUrl(beUrlInput)
  if (result.ok) {
    error = undefined
    savedAt = Date.now()
  } else {
    error = result.error
    savedAt = undefined
  }
}

let showSaved = $derived(savedAt !== undefined && Date.now() - savedAt < 3000)
</script>

<!-- AppShell ללא onDisconnect → disconnect icon מוסתר ב-AppHeader -->
<AppShell>
  <main class="settings py-8 px-4 max-w-lg mx-auto w-full">
    <h1 class="text-xl font-semibold mb-6">{t("settings.title")}</h1>

    <form
      onsubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
      <label class="flex flex-col gap-2">
        <span class="font-semibold text-sm">{t("settings.beUrl.label")}</span>
        <input
          type="url"
          bind:value={beUrlInput}
          onblur={handleSave}
          class:invalid={error !== undefined}
          placeholder="https://my-be.example.com"
          dir="ltr"
          class="px-3 py-2.5 rounded-lg border text-sm outline-none"
          style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
        />
        <span class="text-xs opacity-70">{t("settings.beUrl.help")}</span>
        {#if error}
          <span class="text-xs" style="color:var(--danger)">{t("settings.beUrl.invalid")}: {error}</span>
        {/if}
        {#if showSaved}
          <span class="text-xs" style="color:var(--success)">{t("settings.beUrl.saved")}</span>
        {/if}
      </label>
    </form>
  </main>
</AppShell>
