<script lang="ts">
/**
 * SessionTransportCard — the advanced WS/HTTP preference.
 *
 * Extracted from `SettingsScreen` while adding the new-session folder card: it was the
 * one card still written inline while every other one is a component, and it carried two
 * `$derived` values into the screen's script for nothing else to use.
 */
import { env } from "$env/dynamic/public"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import { getI18n, getSettings } from "$lib/context"
import { resolveSessionTransport, type SessionTransport } from "$lib/session/session-transport"
import SettingsCard from "./SettingsCard.svelte"

const settings = getSettings()
const t = getI18n().t

const options = $derived<SelectOption[]>([
  { value: "ws", label: t("settings.sessionTransport.ws") },
  { value: "http", label: t("settings.sessionTransport.http") },
])

/**
 * Shows the transport the **next** session would use when no preference is stored, not
 * the per-tab override in `sessionStorage` — that one wins only in the tab that set it,
 * so displaying it here would misreport the saved setting.
 */
const display = $derived(
  settings.sessionTransport ??
    resolveSessionTransport({ stored: null, env: env.PUBLIC_SESSION_TRANSPORT }),
)
</script>

<SettingsCard title={t("settings.sessionTransport.label")}>
  <label class="flex flex-col gap-1.5">
    <span class="text-[13px]" style="color:var(--fg-dim)">
      {t("settings.sessionTransport.label")}
    </span>
    <Select
      {options}
      value={display}
      title={t("settings.sessionTransport.label")}
      onchange={(v) => settings.setSessionTransport(v as SessionTransport)}
    />
  </label>
</SettingsCard>
