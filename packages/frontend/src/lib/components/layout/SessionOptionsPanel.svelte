<script lang="ts">
/**
 * SessionOptionsPanel — תוכן משותף DRY לסייד-בר (דסקטופ) ולBottom-Sheet (מובייל).
 *
 * redesign-3: חיווט dropdowns (סוכן/מודל/חשיבה) מתוך לוגיקת AgentOptionsPanel.
 * AgentOptionsPanel נמחק; כל הלוגיקה כאן.
 *
 * ─── redesign-2/3 · slice sessions-inline (סשנים inline, מחליף SessionsDialog) ───
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import { goto } from "$app/navigation"
import { env } from "$env/dynamic/public"
import MachineStatsBar from "$lib/components/connect/MachineStatsBar.svelte"
import SessionFieldsList from "$lib/components/layout/SessionFieldsList.svelte"
import SessionHistoryList from "$lib/components/layout/SessionHistoryList.svelte"
import SessionModeSelect from "$lib/components/layout/SessionModeSelect.svelte"
import SessionScopePolicyCard from "$lib/components/layout/SessionScopePolicyCard.svelte"
import SessionTitleField from "$lib/components/layout/SessionTitleField.svelte"
import CliBadge from "$lib/components/ui/CliBadge.svelte"
import Select, { type SelectGroup, type SelectOption } from "$lib/components/ui/Select.svelte"
import {
  getCliAvailability,
  getI18n,
  getPresencePoller,
  getResponsive,
  getSession,
  getSettings,
  getUiShell,
} from "$lib/context"
import { readSessionTransport } from "$lib/session/session-transport-read"
import { sessionPathWithTransport } from "$lib/session/session-url"
import {
  flattenSelectOptions,
  localizeConfigName,
  toSelectOptions,
} from "$lib/util/session-config-options"
import DisplayOptionsRow from "./DisplayOptionsRow.svelte"
import SessionActionsRow from "./SessionActionsRow.svelte"

const t = getI18n().t
const session = getSession()
const poller = getPresencePoller()
const cliAvailability = getCliAvailability()
// ─── redesign-fix: ⚙ במובייל יורד ל-sheet; navigation toggle כמו ב-AppHeader ───
const responsive = getResponsive()
const uiShell = getUiShell()
// ─── slice sessions-inline: settings לקבלת cliKind לבחירת סשן ───
const settings = getSettings()

/**
 * ‏"idle" = ‏טרם נוצר סוכן. ‏כל מה שפועל **על סשן** מוסתר אז.
 * ‏🛑 ‏לא `inSession` ‏של `+layout.svelte:305-311` — ‏הוא `connected || disconnected`
 * ‏ומוציא `error`, ‏פרדיקט לעניין אחר.
 */
const hasSession = $derived(session.status !== "idle")

// ─── slice session-delete: מחיקת הסשן הפעיל מנווטת החוצה (עקבי עם onDisconnect) ───
async function onDeleteSession(id: string) {
  const wasActive = await session.deleteSession(id)
  if (wasActive) goto("/") // אחרת נשארים על /chat עם עמוד ריק (calev NO-GO fix, DoD #7)
}

// ─── slice leave-running-background: יציאה בלי להרוג ───

// ⚙ toggle (מובייל): ב-/settings → חזרה ל-/chat, אחרת → פתיחה + סגירת ה-sheet.

// ─── slice FEAT-thinking-live: thinking tokens control ───

/** ערכי thinking: off=null, low=4000, medium=8000, high=16000 */
const THINKING_VALUES: Record<string, number | null> = {
  off: null,
  low: 4000,
  medium: 8000,
  high: 16000,
}

let thinkingLevel = $state<string>("off")

async function onThinkingChange(v: string) {
  thinkingLevel = v
  const n = THINKING_VALUES[v] ?? null
  await session.setThinkingTokens(n)
}

const thinkingOptions = $derived([
  { value: "off", label: t("agentOptions.thinking.off") },
  { value: "low", label: t("agentOptions.thinking.low") },
  { value: "medium", label: t("agentOptions.thinking.medium") },
  { value: "high", label: t("agentOptions.thinking.high") },
])

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
  session.configOptions.filter((o) => o.category !== "model" && o.category !== "mode"),
)

/** האם יש אפשרויות סוכן/מודל להציג */
const hasAgentOptions = $derived(
  (session.models?.availableModels?.length ?? 0) > 0 ||
    session.configOptions.some((o) => o.category === "model") ||
    (session.modes?.availableModes?.length ?? 0) > 0 ||
    session.configOptions.some((o) => o.category === "mode") ||
    extraOptions.length > 0,
)

// ─── event handlers ───
async function onCheckboxChange(configId: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  await session.applyConfigOption(configId, checked)
}

// ─── slice sessions-inline: טעינת סשנים inline ───

/** sessionTransport: query ← override ← stored ← env ← "ws" (same as handleReconnect). */
function currentTransport() {
  return readSessionTransport({
    env: env.PUBLIC_SESSION_TRANSPORT,
    stored: settings.sessionTransport,
  })
}

/**
 * Switch the session through the attached view before updating the chat route.
 */
async function selectSession(info: { sessionId: string; cwd: string; title?: string }) {
  await session.switchSession({
    sessionId: info.sessionId,
    cwd: info.cwd,
    cliKind: settings.cliKind,
    title: info.title ?? "", // ← slice session-title: העבר title ל-switchSession
  })
  uiShell.closeSheet()
  await goto(sessionPathWithTransport(settings.cliKind, info.sessionId, currentTransport()))
}

/**
 * סשן חדש: warm new-session על החיבור הקיים — ללא detach/respawn.
 * נשאר ב-/chat עם בועות ריקות, מוכן לפרומפט.
 * ב-remote: rpc session/new על ה-host; כשל → session.error, בלי ניווט.
 */
async function onNewSession() {
  await session.newSession({ cliKind: settings.cliKind })
  if (session.error) return
  uiShell.closeSheet()
  await goto(sessionPathWithTransport(settings.cliKind, session.sessionId, currentTransport()))
}
</script>

<!-- machine stats from presence poller (slice machine-stats-in-session) -->
<MachineStatsBar stats={poller.machine} />
<SessionActionsRow />

<!-- אזור גלילה מאוחד: תצוגה + אפשרויות סוכן + סשנים.
     שורת הפעולות מעל נשארת קבועה (shrink-0); מתגי התצוגה נגללים — במובייל הם אוכלים גובה. -->
<div class="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto chat-scroll -mx-1 px-1">

{#if hasSession}
<SessionTitleField />
<SessionFieldsList />
<DisplayOptionsRow />

<!-- ─── cli-name-in-chat: שם ה-CLI מעל אפשרויות סוכן ─── -->
{#if session.cliKind}
  {@const cliKind = session.cliKind}
  <div class="flex items-center gap-2 px-1 shrink-0 text-[11px]" style="color:var(--fg-dim)">
    <span class="uppercase tracking-wider font-semibold">{t("sidebar.runningOn")}</span>
    <span class="px-2 py-0.5 rounded-md font-mono font-semibold"
          style="background:var(--bg-card); border:1px solid var(--border); color:var(--fg)"
          dir="ltr">
      <CliBadge id={cliKind} displayName={cliAvailability.details[cliKind]?.displayName} variant="inline" />
    </span>
  </div>
{/if}

<!-- אפשרויות סוכן — מחווט מ-redesign-3 -->
<div class="flex flex-col gap-2.5 shrink-0">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-1" style="color:var(--fg-dim)">
    {t("sidebar.agentOptions")}
  </div>

  {#if hasAgentOptions}
    <!-- סוכן + מודל באותה שורה (חצאי רוחב) — מוקאפ redesign-fix -->
    <div class="grid grid-cols-2 gap-2">
      <SessionModeSelect
        configOptions={session.configOptions}
        modes={session.modes}
        onChange={(id, value) => session.applyConfigOption(id, value)}
      />

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

    <!-- thinking-tokens — gated על capabilities -->
    {#if session.supports.thinkingTokens}
    <label class="flex flex-col gap-1">
      <span class="text-[11px] px-1" style="color:var(--fg-dim)">{t("agentOptions.thinking.label")}</span>
      <Select
        value={thinkingLevel}
        options={thinkingOptions}
        title={t("agentOptions.thinking.label")}
        ariaLabel={t("agentOptions.thinking.label")}
        onchange={onThinkingChange}
      />
    </label>
    {/if}

    <!-- שאר configOptions (לא הבורר הראשי של mode/model; כולל אחים באותה קטגוריה — #63) -->
    {#each extraOptions as opt (opt.id)}
      {#if opt.type === "select"}
        {@const choices = flattenSelectOptions(opt)}
        {#if choices.length > 0}
        <label class="flex flex-col gap-1">
          <span class="text-[11px] px-1" style="color:var(--fg-dim)">{localizeConfigName(opt.name, t)}</span>
          <Select
            value={(opt as Extract<typeof opt, { type: "select" }>).currentValue ?? ""}
            options={toSelectOptions(choices)}
            title={localizeConfigName(opt.name, t)}
            ariaLabel={localizeConfigName(opt.name, t)}
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
          <span class="text-[13px]" style="color:var(--fg-dim)">{localizeConfigName(opt.name, t)}</span>
        </label>
      {/if}
    {/each}

  {:else}
    <!-- placeholder כשאין חיבור פעיל -->
    <div class="text-[12px] opacity-40 px-1">{t("agentOptions.mode.label")}: —</div>
  {/if}
</div>
{/if}

{#if session.agentId}
  <SessionScopePolicyCard />
{/if}

<!-- ─── פרומפט מערכת פר-פרויקט ─── (slice project-system-prompt) -->
{#if session.cwd}
<div class="flex flex-col gap-1.5 shrink-0">
  <div class="text-[11px] font-semibold uppercase tracking-wider px-1" style="color:var(--fg-dim)">
    {t("projectPrompt.label")}
  </div>
  <textarea
    class="w-full rounded-lg px-2.5 py-2 text-[13px] resize-y outline-none border"
    style="background:var(--bg-card); border-color:var(--border); color:var(--fg); min-height:4.5em"
    dir="auto"
    rows={3}
    placeholder={t("projectPrompt.placeholder")}
    value={settings.getProjectPrompt(session.cwd)}
    onchange={(e) => settings.setProjectPrompt(session.cwd ?? "", (e.target as HTMLTextAreaElement).value)}
  ></textarea>
  <div class="text-[11px] px-1" style="color:var(--fg-dim)">{t("projectPrompt.hint")}</div>
  {#if session.showsSystemPromptWarning}
    <div class="text-[11px] px-1" style="color:var(--accent)">{t("projectPrompt.unsupported")}</div>
  {/if}
</div>
{/if}

{#if hasSession}
  <SessionHistoryList
    {session}
    visible={!responsive.isMobile || uiShell.sheetOpen}
    currentCwdOnly={settings.sessionsCurrentCwdOnly}
    onCurrentCwdOnlyChange={(value) => settings.setSessionsCurrentCwdOnly(value)}
    onSelectSession={selectSession}
    {onNewSession}
    {onDeleteSession}
  />
{/if}
<!-- /אזור גלילה מאוחד -->
</div>
