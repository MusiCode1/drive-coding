<script lang="ts">
/**
 * SessionOptionsPanel — תוכן משותף DRY לסייד-בר (דסקטופ) ולBottom-Sheet (מובייל).
 *
 * redesign-3: חיווט dropdowns (סוכן/מודל/חשיבה) מתוך לוגיקת AgentOptionsPanel.
 * AgentOptionsPanel נמחק; כל הלוגיקה כאן.
 *
 * ─── redesign-2 ───
 * ─── redesign-3 (חיווט dropdowns) ───
 * ─── slice sessions-inline: סשנים inline (מחליף SessionsDialog) ───
 */
import { untrack } from "svelte"
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw"
import LogOutIcon from "@lucide/svelte/icons/log-out"
import Volume2Icon from "@lucide/svelte/icons/volume-2"
import VolumeXIcon from "@lucide/svelte/icons/volume-x"
import SettingsIcon from "@lucide/svelte/icons/settings"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { getI18n, getSession, getSpeaker, getResponsive, getUiShell, getSettings } from "$lib/context"
import Select, { type SelectOption, type SelectGroup } from "$lib/components/ui/Select.svelte"
import SessionCard from "$lib/components/modals/SessionCard.svelte"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"

const t = getI18n().t
const session = getSession()
// ─── redesign-fix: disconnect + audio הועברו מ-AppHeader (פדיון חוב redesign-2/3) ───
const speaker = getSpeaker()
// ─── redesign-fix: ⚙ במובייל יורד ל-sheet; navigation toggle כמו ב-AppHeader ───
const responsive = getResponsive()
const uiShell = getUiShell()
// ─── slice sessions-inline: settings לקבלת cliKind לבחירת סשן ───
const settings = getSettings()
const onSettings = $derived(page.url.pathname === "/settings")

function onDisconnect() {
  session.detach()
  goto("/")
}

// ⚙ toggle (מובייל): ב-/settings → חזרה ל-/chat, אחרת → פתיחה + סגירת ה-sheet.
function toggleSettings() {
  if (onSettings) {
    goto("/chat")
  } else {
    uiShell.closeSheet()
    goto("/settings")
  }
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

// מודלים: אם ה-modelId מכיל "/" (למשל "anthropic/claude-..") → קבץ לפי החלק
// שלפני ה-slash (הספק). אם אף אחד לא מכיל "/" → רשימה שטוחה (בלי קיבוץ).
const modelGroups = $derived.by<SelectGroup[] | undefined>(() => {
  const models = session.models?.availableModels
  if (!models || models.length === 0) return undefined
  if (!models.some((m) => m.modelId.includes("/"))) return undefined
  const byProvider = new Map<string, SelectOption[]>()
  for (const m of models) {
    const slash = m.modelId.indexOf("/")
    const provider = slash > 0 ? m.modelId.slice(0, slash) : t("agentOptions.model.other")
    const list = byProvider.get(provider) ?? []
    list.push({ value: m.modelId, label: m.name })
    byProvider.set(provider, list)
  }
  return [...byProvider].map(([group, items]) => ({ group, items }))
})

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

// ─── slice sessions-inline: טעינת סשנים inline ───

/**
 * בחירת סשן: detach + loadSession + ניווט ל-/chat.
 * חיקוי של selectSession ב-SessionsDialog (שורות 50-58 שנמחק).
 */
async function selectSession(info: { sessionId: string; cwd: string }) {
  session.detach()
  await session.loadSession({
    sessionId: info.sessionId,
    cwd: info.cwd,
    cliKind: settings.cliKind,
  })
  uiShell.closeSheet()
  await goto("/chat")
}

/**
 * סשן חדש: detach + חזרה לדף החיבור (שם בוחרים cwd/cliKind).
 * detach קודם כדי לשחרר את ה-bridge הנוכחי.
 */
function onNewSession() {
  session.detach()
  goto("/")
}

/**
 * טריגר טעינת סשנים — מגיב ל-responsive.isMobile ו-uiShell.sheetOpen.
 * דסקטופ: sidebar תמיד גלוי → טוען מיד.
 * מובייל: טוען כש-sheetOpen === true (המשתמש פתח את ה-sheet).
 * untrack: listSessions כותב sessionsLoading/Error → בלי untrack נכנסים ללולאה.
 * idempotent+cache (#sessionsLoaded) מונע DDoS אפילו בלי untrack.
 */
$effect(() => {
  const shouldLoad = responsive.isMobile ? uiShell.sheetOpen : true
  if (!shouldLoad) return
  untrack(() => void session.listSessions())
})
</script>

<!-- שורת פעולות עליונה: השתק · נתק · ⚙ — בראש בכל המצבים (redesign-fix) -->
<div class="flex items-center gap-2 shrink-0">
  <!-- audio master toggle -->
  <button
    class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border"
    style="border-color:var(--border); color:var(--fg-dim)"
    onclick={() => speaker.toggle()}
    aria-label={speaker.enabled ? t("header.audioOn") : t("header.audioOff")}
    title={speaker.enabled ? t("header.audioOn") : t("header.audioOff")}
  >
    {#if speaker.enabled}
      <Volume2Icon size={16} strokeWidth={1.75} />
    {:else}
      <VolumeXIcon size={16} strokeWidth={1.75} />
    {/if}
  </button>

  <!-- disconnect -->
  <button
    class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border"
    style="border-color:var(--border); color:var(--recording)"
    onclick={onDisconnect}
    aria-label={t("header.disconnect")}
    title={t("header.disconnect")}
  >
    <LogOutIcon size={16} strokeWidth={1.75} />
  </button>

  <!-- הגדרות — toggle, בראש הרשימה בכל המצבים (ירד מ-AppHeader) -->
  <button
    class="flex-1 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[13px] border"
    style="border-color:var(--border); color:{onSettings ? 'var(--accent)' : 'var(--fg-dim)'}"
    onclick={toggleSettings}
    aria-label={t("header.settings")}
    aria-pressed={onSettings}
    title={t("header.settings")}
  >
    <SettingsIcon size={16} strokeWidth={1.75} />
  </button>
</div>

<!-- אפשרויות סוכן — מחווט מ-redesign-3 -->
<div class="flex flex-col gap-2.5">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-1" style="color:var(--fg-dim)">
    {t("sidebar.agentOptions")}
  </div>

  {#if hasAgentOptions}
    <!-- סוכן + מודל באותה שורה (חצאי רוחב) — מוקאפ redesign-fix -->
    <div class="grid grid-cols-2 gap-2">
      <!-- סוכן/Mode dropdown -->
      {#if (session.modes?.availableModes?.length ?? 0) > 0}
      <label class="flex flex-col gap-1 min-w-0">
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
        <label class="flex flex-col gap-1 min-w-0">
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

      <!-- מודל dropdown — עם חלוקה לספקים (groups) אם יש "/" ב-modelId -->
      {#if (session.models?.availableModels?.length ?? 0) > 0}
      <label class="flex flex-col gap-1 min-w-0">
        <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.model.label")}</span>
        <Select
          value={session.models?.currentModelId ?? ""}
          options={modelGroups ? undefined : toSelectOptions(session.models!.availableModels.map((m) => ({ value: m.modelId, name: m.name })))}
          groups={modelGroups}
          title={t("agentOptions.model.label")}
          ariaLabel={t("agentOptions.model.label")}
          onchange={(v) => session.applyConfigOption("model", v)}
        />
      </label>
      {:else if session.configOptions.find((o) => o.category === "model")}
        {@const modelOpt = session.configOptions.find((o) => o.category === "model")!}
        {@const modelChoices = flattenSelectOptions(modelOpt)}
        {#if modelChoices.length > 0}
        <label class="flex flex-col gap-1 min-w-0">
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
    </div>

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

<!-- סשנים — inline (slice sessions-inline: מחליף SessionsDialog) -->
<div class="flex flex-col gap-2 flex-1 min-h-0">
  <div class="flex items-center justify-between px-1 shrink-0">
    <span class="text-[11px] font-semibold uppercase tracking-wider" style="color:var(--fg-dim)">
      {t("sidebar.sessions")}
    </span>
    <!-- רענון — קורא listSessions(true) ישירות (לא פותח dialog) -->
    <button
      class="size-6 grid place-items-center rounded"
      style="color:var(--fg-dim)"
      title={t("sidebar.refresh")}
      aria-label={t("sidebar.refresh")}
      onclick={() => void session.listSessions(true)}
    >
      <RefreshCwIcon size={13} strokeWidth={2} />
    </button>
  </div>

  <!-- סשן חדש — detach + goto("/") -->
  <button
    class="shrink-0 text-start rounded-lg p-2.5 text-[13px] font-medium border border-dashed"
    style="border-color:var(--border); color:var(--accent)"
    onclick={onNewSession}
  >
    ＋ {t("sidebar.newSession")}
  </button>

  <!-- רשימת סשנים inline -->
  <div class="flex flex-col gap-2 overflow-y-auto chat-scroll flex-1 min-h-0 -mx-1 px-1">
    {#if session.sessionsLoading}
      <div class="text-[12px] opacity-50 px-1">{t("modal.sessions.loading")}</div>
    {:else if session.sessionsError}
      <div class="text-[12px] px-1" style="color:var(--recording)">{t("modal.sessions.error")}: {session.sessionsError}</div>
    {:else}
      {#each session.sessions as s (s.sessionId)}
        <SessionCard session={s} isActive={false} onSelect={() => selectSession(s)} />
      {/each}
    {/if}
  </div>
</div>
