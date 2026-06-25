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
import type { MessageKey } from "@drive-coding/core/i18n"

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

const toSelectOptions = (
  items: { value: string; name: string; description?: string | null }[],
): SelectOption[] => items.map((o) => ({ value: o.value, label: o.name, description: o.description }))

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

/**
 * מילון תרגום: שם config-option שמגיע מה-CLI (אנגלית) → מפתח i18n.
 * הוספת מילה = שורה אחת כאן + ערך מקביל ב-catalogs (he/en). name לא-מוכר נשאר כמות שהוא.
 */
const CONFIG_NAME_KEYS: Record<string, MessageKey> = {
  agent: "configName.agent",
  mode: "configName.mode",
  "session mode": "configName.sessionMode",
  "approval preset": "configName.approvalPreset",
  model: "configName.model",
  effort: "configName.effort",
  "reasoning effort": "configName.reasoningEffort",
}

/** מתרגם שם config-option לעברית אם הוא מוכר; אחרת מחזיר את השם המקורי מה-CLI. */
function localizeConfigName(name: string): string {
  const key = CONFIG_NAME_KEYS[name.trim().toLowerCase()]
  return key ? t(key) : name
}

/**
 * תווית בורר ה-mode — מתורגמת מה-name שה-CLI נותן ל-config-option בקטגוריית mode
 * (opencode="Session Mode", claude="Mode", codex="Approval Preset") דרך localizeConfigName,
 * עם fallback ל-i18n "מצב". מדויק פר-ספק ומונע התנגשות-שם עם config-option "agent"
 * (category=null, נופל ל-extraOptions עם שמו "Agent").
 */
const modeLabel = $derived.by(() => {
  const name = session.configOptions.find((o) => o.category === "mode")?.name
  return name ? localizeConfigName(name) : t("agentOptions.mode.label")
})

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
 * בחירת סשן: switchSession (warm reload על החיבור הקיים) + ניווט ל-/chat.
 * אם אין חיבור (#client === null) — switchSession נופל ל-loadSession הכבד (דפנסיבי).
 */
async function selectSession(info: { sessionId: string; cwd: string; title?: string }) {
  await session.switchSession({
    sessionId: info.sessionId,
    cwd: info.cwd,
    cliKind: settings.cliKind,
    title: info.title ?? "",   // ← slice session-title: העבר title ל-switchSession
  })
  uiShell.closeSheet()
  await goto("/chat")
}

/**
 * סשן חדש: warm new-session על החיבור הקיים — ללא detach/respawn.
 * נשאר ב-/chat עם בועות ריקות, מוכן לפרומפט.
 */
async function onNewSession() {
  await session.newSession({ cliKind: settings.cliKind })
  uiShell.closeSheet()
  await goto("/chat")
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

<!-- שורת פעולות עליונה: נתק · השתק · ⚙ — בראש בכל המצבים (redesign-fix) -->
<!-- סדר DOM: disconnect ראשון = ימני ביותר ב-RTL -->
<div class="flex items-center gap-2 shrink-0">
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

<!-- אזור גלילה מאוחד: אפשרויות סוכן + סשנים. הגלילה מתחילה מכאן (מסקשן אפשרויות סוכן),
     כך שכשהגובה קטן ראש הרשימה לא נחתך אלא נגלל. שורת הפעולות מעל נשארת קבועה (shrink-0). -->
<div class="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto chat-scroll -mx-1 px-1">

<!-- אפשרויות סוכן — מחווט מ-redesign-3 -->
<div class="flex flex-col gap-2.5 shrink-0">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-1" style="color:var(--fg-dim)">
    {t("sidebar.agentOptions")}
  </div>

  {#if hasAgentOptions}
    <!-- סוכן + מודל באותה שורה (חצאי רוחב) — מוקאפ redesign-fix -->
    <div class="grid grid-cols-2 gap-2">
      <!-- סוכן/Mode dropdown -->
      {#if (session.modes?.availableModes?.length ?? 0) > 0}
      <label class="flex flex-col gap-1 min-w-0">
        <span class="text-[11px] px-1" style="color:var(--fg-dim)">{modeLabel}</span>
        <Select
          value={session.modes?.currentModeId ?? ""}
          options={toSelectOptions(session.modes!.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description })))}
          title={modeLabel}
          ariaLabel={modeLabel}
          onchange={(v) => session.applyConfigOption("mode", v)}
        />
      </label>
      {:else if session.configOptions.find((o) => o.category === "mode")}
        {@const modeOpt = session.configOptions.find((o) => o.category === "mode")!}
        {@const modeChoices = flattenSelectOptions(modeOpt)}
        {#if modeChoices.length > 0}
        <label class="flex flex-col gap-1 min-w-0">
          <span class="text-[11px] px-1" style="color:var(--fg-dim)">{modeLabel}</span>
          <Select
            value={(modeOpt as Extract<typeof modeOpt, { type: "select" }>).currentValue ?? ""}
            options={toSelectOptions(modeChoices)}
            title={modeLabel}
            ariaLabel={modeLabel}
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
          <span class="text-[11px] px-1" style="color:var(--fg-dim)">{localizeConfigName(opt.name)}</span>
          <Select
            value={(opt as Extract<typeof opt, { type: "select" }>).currentValue ?? ""}
            options={toSelectOptions(choices)}
            title={localizeConfigName(opt.name)}
            ariaLabel={localizeConfigName(opt.name)}
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
          <span class="text-[13px]" style="color:var(--fg-dim)">{localizeConfigName(opt.name)}</span>
        </label>
      {/if}
    {/each}

  {:else}
    <!-- placeholder כשאין חיבור פעיל -->
    <div class="text-[12px] opacity-40 px-1">{modeLabel}: —</div>
  {/if}
</div>

<!-- סשנים — inline (slice sessions-inline: מחליף SessionsDialog) -->
<div class="flex flex-col gap-2 shrink-0">
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

  <!-- סשן חדש — warm new-session על החיבור הקיים; disabled כשלא connected -->
  <button
    class="shrink-0 text-start rounded-lg p-2.5 text-[13px] font-medium border border-dashed disabled:opacity-40 disabled:cursor-not-allowed"
    style="border-color:var(--border); color:var(--accent)"
    disabled={session.status !== "connected"}
    onclick={onNewSession}
  >
    ＋ {t("sidebar.newSession")}
  </button>

  <!-- רשימת סשנים inline — בלי scroll/flex-1 פנימי: גוללת יחד עם אזור הגלילה המאוחד -->
  <div class="flex flex-col gap-2">
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
<!-- /אזור גלילה מאוחד -->
</div>
