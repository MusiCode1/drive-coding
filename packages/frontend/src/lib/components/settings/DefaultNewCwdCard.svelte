<script lang="ts">
/**
 * DefaultNewCwdCard — the folder a `/chat/<cli>/new` link falls back to.
 *
 * The middle link of the chain locked on 2026-09-10
 * (`pre-brief-chat-new-open-routes.md` §7#1): `?cwd=` → this → folder picker. Empty is a
 * valid value and means "show the picker", which is what the link did before this card
 * existed.
 *
 * 🛑 Absolute only. A relative default would be joined to the home directory at spawn
 * time, and the same decision forbids that guess — the user would name one folder and
 * land in another with no error.
 */
import { getI18n, getSettings } from "$lib/context"
import { isAbsoluteProjectPath } from "$lib/view-models/settings-new-session"
import SettingsCard from "./SettingsCard.svelte"

const settings = getSettings()
const t = getI18n().t

let input = $state(settings.defaultNewCwd)

const invalid = $derived(input.trim() !== "" && !isAbsoluteProjectPath(input.trim()))

function commit() {
  if (invalid) return
  settings.setDefaultNewCwd(input)
  input = settings.defaultNewCwd
}
</script>

<SettingsCard title={t("settings.defaultNewCwd.label")}>
  <label class="flex flex-col gap-1.5">
    <input
      dir="ltr"
      bind:value={input}
      placeholder="/home/you/Projects/app"
      class="rounded-xl px-3 py-3 text-sm font-mono outline-none border"
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
      onblur={commit}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          commit()
        }
      }}
    />
    {#if invalid}
      <span class="text-[12px]" style="color:var(--recording)">
        {t("settings.defaultNewCwd.absoluteOnly")}
      </span>
    {:else}
      <span class="text-[12px]" style="color:var(--fg-muted)">
        {t("settings.defaultNewCwd.help")}
      </span>
    {/if}
  </label>
</SettingsCard>
