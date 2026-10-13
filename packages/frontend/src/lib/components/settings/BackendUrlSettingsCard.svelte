<script lang="ts">
import { getI18n, getSettings } from "$lib/context"
import SettingsCard from "./SettingsCard.svelte"

const settings = getSettings()
const t = getI18n().t

let beUrlInput = $state(settings.beUrl)
let beUrlStatus = $state<{ kind: "idle" | "saved" | "error"; msg?: string }>({ kind: "idle" })

function commitBeUrl() {
  const res = settings.setBeUrl(beUrlInput)
  if (res.ok) {
    beUrlInput = settings.beUrl
    beUrlStatus = { kind: "saved" }
  } else {
    beUrlStatus = { kind: "error", msg: res.error }
  }
}

$effect(() => {
  if (beUrlStatus.kind !== "saved") return
  const timer = setTimeout(() => {
    beUrlStatus = { kind: "idle" }
  }, 3000)
  return () => clearTimeout(timer)
})
</script>

<SettingsCard title={t("settings.beUrl.label")}>
  <label class="flex flex-col gap-1.5">
    <input
      dir="ltr"
      bind:value={beUrlInput}
      placeholder="https://be.example.com"
      class="rounded-xl px-3 py-3 text-sm font-mono outline-none border"
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
      oninput={() => (beUrlStatus = { kind: "idle" })}
      onblur={commitBeUrl}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          commitBeUrl()
        }
      }}
    />
    {#if beUrlStatus.kind === "error"}
      <span class="text-[12px]" style="color:var(--recording)">{t("settings.beUrl.invalid")}</span>
    {:else if beUrlStatus.kind === "saved"}
      <span class="text-[12px]" style="color:var(--accent)">{t("settings.beUrl.saved")}</span>
    {:else}
      <span class="text-[12px]" style="color:var(--fg-muted)">{t("settings.beUrl.help")}</span>
    {/if}
  </label>
</SettingsCard>
