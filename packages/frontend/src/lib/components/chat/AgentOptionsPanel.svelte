<script lang="ts">
/**
 * AgentOptionsPanel — ווידג'ט מתקפל להחלת config על הסשן הפתוח.
 *
 * מציג dropdowns למודל/סוכן + כל configOptions מה-agent.
 * נעלם לגמרי אם ה-agent לא מחזיר שום config.
 * flex-shrink: 0 חובה — ה-chat-page הוא flex-column height:100dvh.
 *
 * Slice 23.
 */

import { getSession, getI18n } from "$lib/context"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"

const session = getSession()
const t = getI18n().t

// ─── state מקומי ───
let open = $state(false)
let autoOpened = false   // guard — auto-open once only (prevents re-open on user close)

// ─── helper — flatten select options (groups → flat list) ───
type SelectOpt = { value: string; name: string; description?: string | null }

function flattenSelectOptions(option: SessionConfigOption): SelectOpt[] {
  if (option.type !== "select") return []
  const sel = option as Extract<SessionConfigOption, { type: "select" }>
  return sel.options.flatMap((item) => ("options" in item ? item.options : [item]))
}

// ─── חישובים ───

/** configOptions שאינם model/mode (מוצגים בנפרד) */
const extraOptions = $derived(
  session.configOptions.filter((o) => o.category !== "model" && o.category !== "mode")
)

/** האם יש תוכן כלשהו להציג */
const hasContent = $derived(
  (session.models?.availableModels?.length ?? 0) > 0 ||
  session.configOptions.some((o) => o.category === "model") ||
  (session.modes?.availableModes?.length ?? 0) > 0 ||
  session.configOptions.some((o) => o.category === "mode") ||
  extraOptions.length > 0
)

// פתח אוטומטית כשיש תוכן — פעם אחת בלבד
$effect(() => {
  if (hasContent && !autoOpened) {
    autoOpened = true
    open = true
  }
})

// ─── event handlers ───
async function onModelChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  await session.applyConfigOption("model", value)
}

async function onModeChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  await session.applyConfigOption("mode", value)
}

async function onSelectChange(configId: string, e: Event) {
  const value = (e.target as HTMLSelectElement).value
  await session.applyConfigOption(configId, value)
}

async function onCheckboxChange(configId: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  await session.applyConfigOption(configId, checked)
}
</script>

{#if hasContent}
<div class="agent-options-panel">
  <button class="toggle-btn" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="toggle-title">{t("agentOptions.title")}</span>
    <span class="toggle-arrow" class:open>{open ? "▲" : "▼"}</span>
  </button>

  {#if open}
  <div class="options-body">

    <!-- ── Model dropdown ── -->
    {#if (session.models?.availableModels?.length ?? 0) > 0}
    <div class="option-row">
      <label class="option-label" for="agent-options-model">{t("agentOptions.model.label")}</label>
      <select
        id="agent-options-model"
        class="option-select"
        value={session.models?.currentModelId}
        onchange={onModelChange}
      >
        {#each session.models!.availableModels as m (m.modelId)}
          <option value={m.modelId}>{m.name}</option>
        {/each}
      </select>
    </div>
    {:else}
    {#if session.configOptions.find((o) => o.category === "model")}
      {@const modelOpt = session.configOptions.find((o) => o.category === "model")!}
      {@const modelChoices = flattenSelectOptions(modelOpt)}
      {#if modelChoices.length > 0}
      <div class="option-row">
        <label class="option-label" for="agent-options-model">{t("agentOptions.model.label")}</label>
        <select
          id="agent-options-model"
          class="option-select"
          value={(modelOpt as Extract<typeof modelOpt, { type: "select" }>).currentValue}
          onchange={(e) => onSelectChange(modelOpt.id, e)}
        >
          {#each modelChoices as opt (opt.value)}
            <option value={opt.value}>{opt.name}</option>
          {/each}
        </select>
      </div>
      {/if}
    {/if}
    {/if}

    <!-- ── Agent/Mode dropdown ── -->
    {#if (session.modes?.availableModes?.length ?? 0) > 0}
    <div class="option-row">
      <label class="option-label" for="agent-options-mode">{t("agentOptions.agent.label")}</label>
      <select
        id="agent-options-mode"
        class="option-select"
        value={session.modes?.currentModeId}
        onchange={onModeChange}
      >
        {#each session.modes!.availableModes as m (m.id)}
          <option value={m.id}>{m.name}</option>
        {/each}
      </select>
    </div>
    {:else}
    {#if session.configOptions.find((o) => o.category === "mode")}
      {@const modeOpt = session.configOptions.find((o) => o.category === "mode")!}
      {@const modeChoices = flattenSelectOptions(modeOpt)}
      {#if modeChoices.length > 0}
      <div class="option-row">
        <label class="option-label" for="agent-options-mode">{t("agentOptions.agent.label")}</label>
        <select
          id="agent-options-mode"
          class="option-select"
          value={(modeOpt as Extract<typeof modeOpt, { type: "select" }>).currentValue}
          onchange={(e) => onSelectChange(modeOpt.id, e)}
        >
          {#each modeChoices as opt (opt.value)}
            <option value={opt.value}>{opt.name}</option>
          {/each}
        </select>
      </div>
      {/if}
    {/if}
    {/if}

    <!-- ── שאר configOptions (לא model/mode) ── -->
    {#each extraOptions as opt (opt.id)}
      {#if opt.type === "select"}
        {@const choices = flattenSelectOptions(opt)}
        {#if choices.length > 0}
        <div class="option-row">
          <label class="option-label" for={"agent-options-" + opt.id}>{opt.name}</label>
          <select
            id={"agent-options-" + opt.id}
            class="option-select"
            value={(opt as Extract<typeof opt, { type: "select" }>).currentValue}
            onchange={(e) => onSelectChange(opt.id, e)}
          >
            {#each choices as o (o.value)}
              <option value={o.value}>{o.name}</option>
            {/each}
          </select>
        </div>
        {/if}
      {:else if opt.type === "boolean"}
        <div class="option-row option-row--checkbox">
          <label class="option-label" for={"agent-options-" + opt.id}>{opt.name}</label>
          <input
            type="checkbox"
            id={"agent-options-" + opt.id}
            class="option-checkbox"
            checked={(opt as Extract<typeof opt, { type: "boolean" }>).currentValue}
            onchange={(e) => onCheckboxChange(opt.id, e)}
          />
        </div>
      {/if}
    {/each}

  </div>
  {/if}
</div>
{/if}

<style>
  .agent-options-panel {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
    background: var(--surface-alt, rgba(255,255,255,0.03));
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.4rem 1rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted, rgba(255,255,255,0.5));
    font-size: 0.78rem;
    text-align: start;
  }

  .toggle-btn:hover {
    color: var(--text, rgba(255,255,255,0.8));
  }

  .toggle-title {
    font-weight: 500;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .toggle-arrow {
    font-size: 0.65rem;
    transition: transform 0.15s ease;
  }

  .options-body {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.2rem;
    padding: 0.4rem 1rem 0.6rem;
  }

  .option-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .option-row--checkbox {
    flex-direction: row-reverse;
    gap: 0.5rem;
  }

  .option-label {
    font-size: 0.75rem;
    color: var(--text-muted, rgba(255,255,255,0.5));
    white-space: nowrap;
  }

  .option-select {
    font-size: 0.8rem;
    padding: 0.2rem 0.4rem;
    background: var(--surface, rgba(255,255,255,0.06));
    border: 1px solid var(--border, rgba(255,255,255,0.12));
    border-radius: 4px;
    color: var(--text, rgba(255,255,255,0.85));
    cursor: pointer;
    max-width: 220px;
  }

  .option-select:hover {
    border-color: var(--accent, rgba(100,160,255,0.5));
  }

  .option-checkbox {
    cursor: pointer;
    accent-color: var(--accent, #5599ff);
    width: 14px;
    height: 14px;
  }
</style>
