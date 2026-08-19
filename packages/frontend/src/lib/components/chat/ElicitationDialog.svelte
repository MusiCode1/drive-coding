<script lang="ts">
/**
 * ElicitationDialog — שאלה מובנת חיה מהסוכן, inline בצ'אט (סגנון PermissionRequestBlock,
 * לא modal — עקביות עם A1 בבחירת §9 Q3 בבריף). form דינמי מ-requestedSchema.
 *
 * מוצג ע"י ChatBubbles כש-session.pendingElicitation לא-null (מחוץ ל-Virtualizer,
 * אחרי הרשימה — כמו PermissionRequestBlock/PlanChecklist/StatusBubble). props בלבד —
 * לא ניגש ל-session ישירות (מחקה את דפוס PermissionRequestBlock, §3 בבריף).
 *
 * message ותוויות-שדות (schema.title) מגיעים מהסוכן — מוצגים as-is. רק תוויות-כפתורים
 * ו-"שדה חובה" דרך t().
 *
 * mode:"form" בלבד ב-scope (§2 בבריף) — mode:"url"/custom מפתרים מיידית כ-cancel
 * (אין UI לרנדר בלעדיהם; לא לתקוע turn).
 *
 * ─── slice-elicitation-ui Commit 3 ───
 */

import Avatar from "$lib/components/chat/Avatar.svelte"
import Select from "$lib/components/ui/Select.svelte"
import { getI18n } from "$lib/context"
import {
  type ElicitationParams,
  isFormElicitation,
  mapElicitationFields,
} from "$lib/types/elicitation"

let {
  params,
  onResolve,
  onDecline,
  onCancel,
}: {
  params: ElicitationParams
  onResolve: (content: Record<string, string | number | boolean>) => void
  onDecline: () => void
  onCancel: () => void
} = $props()

const t = getI18n().t

const isForm = $derived(isFormElicitation(params))
// קריאה ישירה ל-isFormElicitation (לא דרך isForm) — type-guard narrowing עובד רק על
// קריאה ישירה בתנאי, לא על boolean $derived שנשמר בנפרד.
const fields = $derived(
  isFormElicitation(params) ? mapElicitationFields(params.requestedSchema) : [],
)
// message — as-is מהסוכן (§1 בבריף)
const message = $derived(params.message)

// ─── ערכי הטופס — store נפרד פר-kind (type-safety על bind:value/bind:checked) ───
// ⚠️ אתחול **סינכרוני** (לפני ה-paint הראשון) כדי ש-bind:value/bind:checked לעולם לא יקבל
// undefined — Svelte 5 מסרב לכרוך undefined ל-$bindable עם default (Select `value=$bindable("")`),
// וזה קרס את ה-dialog ב-mount על שדות select → pendingElicitation תקוע לנצח (calev NO-GO r2).
// supersede/בקשה-חדשה מטופל ע"י `{#key session.pendingElicitation}` ב-ChatBubbles (remount נקי).
function initValues(fs: ReturnType<typeof mapElicitationFields>) {
  const text: Record<string, string> = {}
  const num: Record<string, number | undefined> = {}
  const bool: Record<string, boolean> = {}
  for (const f of fs) {
    if (f.kind === "boolean") bool[f.key] = false
    else if (f.kind === "number") num[f.key] = undefined
    else text[f.key] = ""
  }
  return { text, num, bool }
}
// svelte-ignore state_referenced_locally -- params is immutable-per-instance: parent ChatBubbles.svelte
// wraps this component in {#key session.pendingElicitation} (calev NO-GO r2 fix), so this one-time
// read is intentional (seeding the initial $state values, not a reactive dependency).
const _init = initValues(isFormElicitation(params) ? mapElicitationFields(params.requestedSchema) : [])
let textValues = $state<Record<string, string>>(_init.text)
let numberValues = $state<Record<string, number | undefined>>(_init.num)
let boolValues = $state<Record<string, boolean>>(_init.bool)

// mode לא-נתמך (url/custom — §2 out of scope) → פתור מיידית כ-cancel, אין UI לרנדר.
$effect(() => {
  if (!isForm) {
    onCancel()
  }
})

const canSubmit = $derived(
  fields.every((f) => {
    if (!f.required) return true
    if (f.kind === "boolean") return true // boolean תמיד יש לו ערך (false תקין)
    if (f.kind === "number") return numberValues[f.key] !== undefined
    return (textValues[f.key] ?? "").trim() !== ""
  }),
)

// disabled אחרי קליק ראשון — מונע double-submit בזמן שה-VM מאפס את pendingElicitation
// (מחקה את PermissionRequestBlock — גשר-הגנה קצר).
let submitting = $state(false)

function buildContent(): Record<string, string | number | boolean> {
  const content: Record<string, string | number | boolean> = {}
  for (const f of fields) {
    if (f.kind === "boolean") {
      content[f.key] = boolValues[f.key] ?? false
      continue
    }
    if (f.kind === "number") {
      const v = numberValues[f.key]
      if (v !== undefined) content[f.key] = v
      continue
    }
    const v = textValues[f.key]
    if (v !== undefined && v !== "") content[f.key] = v
  }
  return content
}

function handleAccept(): void {
  if (submitting || !canSubmit) return
  submitting = true
  onResolve(buildContent())
}

function handleDecline(): void {
  if (submitting) return
  submitting = true
  onDecline()
}

function handleCancel(): void {
  if (submitting) return
  submitting = true
  onCancel()
}
</script>

{#if isForm}
  <div class="flex gap-2 self-end max-w-[78%] min-w-0 items-end flex-row-reverse pb-5">
    <Avatar kind="tool" />

    <div class="elicitation-block" role="alertdialog" aria-live="assertive">
      <div class="header">
        <span class="message" dir="auto">{message}</span>
        <button
          class="close-btn"
          onclick={handleCancel}
          disabled={submitting}
          aria-label={t("elicitation.cancel")}
        >
          ✕
        </button>
      </div>

      {#if fields.length > 0}
        <div class="fields">
          {#each fields as field (field.key)}
            <div class="field">
              <span class="field-label" dir="auto">
                {field.label}
                {#if field.required}<span class="required-mark" title={t("elicitation.required")}>*</span>{/if}
              </span>
              {#if field.kind === "text"}
                <input
                  type="text"
                  class="field-input"
                  dir="auto"
                  disabled={submitting}
                  bind:value={textValues[field.key]}
                />
              {:else if field.kind === "number"}
                <input
                  type="number"
                  class="field-input"
                  disabled={submitting}
                  bind:value={numberValues[field.key]}
                />
              {:else if field.kind === "boolean"}
                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    disabled={submitting}
                    bind:checked={boolValues[field.key]}
                  />
                  <span dir="auto">{field.label}</span>
                </label>
              {:else if field.kind === "select"}
                <Select
                  bind:value={textValues[field.key]}
                  options={field.options ?? []}
                  title={field.label}
                  disabled={submitting}
                  compact={false}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="actions">
        <button
          class="btn accept"
          disabled={submitting || !canSubmit}
          onclick={handleAccept}
        >
          {t("elicitation.accept")}
        </button>
        <button class="btn decline" disabled={submitting} onclick={handleDecline}>
          {t("elicitation.decline")}
        </button>
        <button class="btn cancel" disabled={submitting} onclick={handleCancel}>
          {t("elicitation.cancel")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .elicitation-block {
    border-radius: 0.75rem;
    border: 1px solid var(--accent);
    background: var(--bg-card);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .message {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--fg);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1;
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .close-btn:hover:not(:disabled) {
    background: var(--bg);
  }
  .close-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-label {
    font-size: 0.75rem;
    color: var(--fg-dim);
  }

  .required-mark {
    color: var(--recording);
    margin-inline-start: 0.15rem;
  }

  .field-input {
    border-radius: 0.5rem;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--fg);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }

  .btn {
    border-radius: 0.5rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn.accept {
    border-color: var(--accent);
    color: var(--accent-hi, var(--accent));
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .btn.decline,
  .btn.cancel {
    border-color: var(--recording);
    color: var(--recording);
  }
</style>
