<script lang="ts">
/**
 * SessionOptionsPanel — תוכן משותף DRY לסייד-בר (דסקטופ) ולBottom-Sheet (מובייל).
 *
 * redesign-3: חיווט dropdowns (סוכן/מודל/חשיבה) מתוך לוגיקת AgentOptionsPanel.
 * AgentOptionsPanel נמחק; כל הלוגיקה כאן.
 *
 * ─── redesign-2 ───
 * ─── redesign-3 (חיווט dropdowns) ───
 */
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw"
import LogOutIcon from "@lucide/svelte/icons/log-out"
import Volume2Icon from "@lucide/svelte/icons/volume-2"
import VolumeXIcon from "@lucide/svelte/icons/volume-x"
import { goto } from "$app/navigation"
import { getI18n, getSession, getModals, getSpeaker } from "$lib/context"
import Select, { type SelectOption } from "$lib/components/ui/Select.svelte"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"

const t = getI18n().t
const session = getSession()
// ─── redesign-6 ───
const modals = getModals()
// ─── redesign-fix: disconnect + audio הועברו מ-AppHeader (פדיון חוב redesign-2/3) ───
const speaker = getSpeaker()

function onDisconnect() {
  session.detach()
  goto("/")
}

// ─── helper — flatten select options (groups → flat list) ───
type SelectOpt = { value: string; name: string; description?: string | null }

function flattenSelectOptions(option: SessionConfigOption): SelectOpt[] {
  if (option.type !== "select") return []
  const sel = option as Extract<SessionConfigOption, { type: "select" }>
  return sel.options.flatMap((item) => ("options" in item ? item.options : [item]))
}

const toSelectOptions = (items: { value: string; name: string }[]): SelectOption[] =>
  items.map((o) => ({ value: o.value, label: o.name }))

// ─── חישובים ───

/** configOptions שאינם model/mode */
const extraOptions = $derived(
  session.configOptions.filter((o) => o.category !== "model" && o.category !== "mode")
)

/** האם יש אפשרויות סוכן/מודל להציג */
const hasAgentOptions = $derived(
  (session.models?.availableModels?.length ?? 0) > 0 ||
  session.configOptions.some((o) => o.category === "model") ||
  (session.modes?.availableModes?.length ?? 0) > 0 ||
  session.configOptions.some((o) => o.category === "mode") ||
  extraOptions.length > 0
)

// ─── event handlers ───
async function onCheckboxChange(configId: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  await session.applyConfigOption(configId, checked)
}
</script>

<!-- אפשרויות סוכן — מחווט מ-redesign-3 -->
<div class="flex flex-col gap-2.5">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-1" style="color:var(--fg-dim)">
    {t("sidebar.agentOptions")}
  </div>

  {#if hasAgentOptions}
    <!-- סוכן/Mode dropdown -->
    {#if (session.modes?.availableModes?.length ?? 0) > 0}
    <label class="flex flex-col gap-1">
      <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.agent.label")}</span>
      <Select
        value={session.modes?.currentModeId ?? ""}
        options={toSelectOptions(session.modes!.availableModes.map((m) => ({ value: m.id, name: m.name })))}
        title={t("agentOptions.agent.label")}
        ariaLabel={t("agentOptions.agent.label")}
        onchange={(v) => session.applyConfigOption("mode", v)}
      />
    </label>
    {:else if session.configOptions.find((o) => o.category === "mode")}
      {@const modeOpt = session.configOptions.find((o) => o.category === "mode")!}
      {@const modeChoices = flattenSelectOptions(modeOpt)}
      {#if modeChoices.length > 0}
      <label class="flex flex-col gap-1">
        <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.agent.label")}</span>
        <Select
          value={(modeOpt as Extract<typeof modeOpt, { type: "select" }>).currentValue ?? ""}
          options={toSelectOptions(modeChoices)}
          title={t("agentOptions.agent.label")}
          ariaLabel={t("agentOptions.agent.label")}
          onchange={(v) => session.applyConfigOption(modeOpt.id, v)}
        />
      </label>
      {/if}
    {/if}

    <!-- מודל dropdown -->
    {#if (session.models?.availableModels?.length ?? 0) > 0}
    <label class="flex flex-col gap-1">
      <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.model.label")}</span>
      <Select
        value={session.models?.currentModelId ?? ""}
        options={toSelectOptions(session.models!.availableModels.map((m) => ({ value: m.modelId, name: m.name })))}
        title={t("agentOptions.model.label")}
        ariaLabel={t("agentOptions.model.label")}
        onchange={(v) => session.applyConfigOption("model", v)}
      />
    </label>
    {:else if session.configOptions.find((o) => o.category === "model")}
      {@const modelOpt = session.configOptions.find((o) => o.category === "model")!}
      {@const modelChoices = flattenSelectOptions(modelOpt)}
      {#if modelChoices.length > 0}
      <label class="flex flex-col gap-1">
        <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.model.label")}</span>
        <Select
          value={(modelOpt as Extract<typeof modelOpt, { type: "select" }>).currentValue ?? ""}
          options={toSelectOptions(modelChoices)}
          title={t("agentOptions.model.label")}
          ariaLabel={t("agentOptions.model.label")}
          onchange={(v) => session.applyConfigOption(modelOpt.id, v)}
        />
      </label>
      {/if}
    {/if}

    <!-- שאר configOptions (לא model/mode) -->
    {#each extraOptions as opt (opt.id)}
      {#if opt.type === "select"}
        {@const choices = flattenSelectOptions(opt)}
        {#if choices.length > 0}
        <label class="flex flex-col gap-1">
          <span class="text-[11px] px-1" style="color:var(--fg-dim)">{opt.name}</span>
          <Select
            value={(opt as Extract<typeof opt, { type: "select" }>).currentValue ?? ""}
            options={toSelectOptions(choices)}
            title={opt.name}
            ariaLabel={opt.name}
            onchange={(v) => session.applyConfigOption(opt.id, v)}
          />
        </label>
        {/if}
      {:else if opt.type === "boolean"}
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            class="cursor-pointer"
            checked={(opt as Extract<typeof opt, { type: "boolean" }>).currentValue}
            onchange={(e) => onCheckboxChange(opt.id, e)}
          />
          <span class="text-[13px]" style="color:var(--fg-dim)">{opt.name}</span>
        </label>
      {/if}
    {/each}

  {:else}
    <!-- placeholder כשאין חיבור פעיל -->
    <div class="text-[12px] opacity-40 px-1">{t("agentOptions.agent.label")}: —</div>
  {/if}
</div>

<!-- סשנים -->
<div class="flex flex-col gap-2 flex-1 min-h-0">
  <div class="flex items-center justify-between px-1 shrink-0">
    <span class="text-[11px] font-semibold uppercase tracking-wider" style="color:var(--fg-dim)">
      {t("sidebar.sessions")}
    </span>
    <!-- redesign-6: פותח SessionsDialog -->
    <button
      class="size-6 grid place-items-center rounded"
      style="color:var(--fg-dim)"
      title={t("sidebar.refresh")}
      aria-label={t("sidebar.refresh")}
      onclick={() => modals.openSessions()}
    >
      <RefreshCwIcon size={13} strokeWidth={2} />
    </button>
  </div>

  <!-- סשן חדש — פותח SessionsDialog -->
  <button
    class="shrink-0 text-start rounded-lg p-2.5 text-[13px] font-medium border border-dashed"
    style="border-color:var(--border); color:var(--accent)"
    onclick={() => modals.openSessions()}
  >
    ＋ {t("sidebar.newSession")}
  </button>

  <!-- placeholder רשימת סשנים -->
  <div class="flex flex-col gap-2 overflow-y-auto chat-scroll flex-1 min-h-0 -mx-1 px-1">
    <!-- רשימה מלאה ב-SessionsDialog -->
  </div>
</div>

<!-- פעולות סשן — audio toggle + disconnect (פדיון חוב: הועברו מ-AppHeader) -->
<div class="flex flex-col gap-2 shrink-0 pt-2 border-t" style="border-color:var(--border)">
  <!-- audio master toggle -->
  <button
    class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px]"
    style="color:var(--fg-dim)"
    onclick={() => speaker.toggle()}
    aria-label={speaker.enabled ? t("header.audioOn") : t("header.audioOff")}
  >
    {#if speaker.enabled}
      <Volume2Icon size={16} strokeWidth={1.75} />
      <span>{t("header.audioOn")}</span>
    {:else}
      <VolumeXIcon size={16} strokeWidth={1.75} />
      <span>{t("header.audioOff")}</span>
    {/if}
  </button>

  <!-- disconnect -->
  <button
    class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px]"
    style="color:var(--recording)"
    onclick={onDisconnect}
    aria-label={t("header.disconnect")}
  >
    <LogOutIcon size={16} strokeWidth={1.75} />
    <span>{t("header.disconnect")}</span>
  </button>
</div>
