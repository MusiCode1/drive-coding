<script lang="ts" module>
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}
export interface SelectGroup {
  group: string
  items: SelectOption[]
}
</script>

<script lang="ts">
/**
 * Select — בורר רספונסיבי. שני מצבי תצוגה לפי גודל מסך (getResponsive):
 *  - מובייל: Dialog ממורכז (Bits) עם רשימה גלילה — נוח לאצבע, לא מתנגש ב-BottomSheet.
 *  - דסקטופ: Popover מעוגן ל-trigger (Bits) — תפריט שצף מתחת לכפתור, כמו select רגיל
 *    אך מעוצב (ה-Dialog הממורכז מוגזם לעכבר).
 *
 * שני המצבים חולקים את אותו trigger ואת אותה רשימת-אפשרויות (snippet `list`).
 *
 * הוחלף ב-redesign-fix: היה native <select> מעוצב (redesign-3) → Dialog בלבד
 * (redesign-fix מובייל) → עכשיו Dialog/Popover לפי מסך.
 *
 * תומך flat (options) או מקובץ-לקטגוריות (groups, עם כותרות-קבוצה sticky).
 *
 * שימוש:
 *   <Select bind:value options={[{value,label}]} title="בחר…" />
 *   <Select bind:value groups={[{group, items:[…]}]} title="בחר…" />
 *
 * ─── ui · redesign-fix ───
 */
import { Dialog, Popover } from "bits-ui"
import CheckIcon from "@lucide/svelte/icons/check"
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down"
import { getResponsive } from "$lib/context"

interface Props {
  value?: string
  options?: SelectOption[]
  groups?: SelectGroup[]
  placeholder?: string
  title?: string
  disabled?: boolean
  ariaLabel?: string
  /** קומפקטי: trigger ברוחב תוכן (inline) במקום מלא. ברירת מחדל מלא. */
  compact?: boolean
  onchange?: (value: string) => void
}

let {
  value = $bindable(""),
  options,
  groups,
  placeholder = "",
  title,
  disabled = false,
  ariaLabel,
  compact = false,
  onchange,
}: Props = $props()

const responsive = getResponsive()

let open = $state(false)

// מאחד flat + grouped למבנה אחיד לרינדור (flat → קבוצה אחת ללא כותרת).
const renderGroups = $derived<SelectGroup[]>(
  groups ?? [{ group: "", items: options ?? [] }],
)

const allItems = $derived(renderGroups.flatMap((g) => g.items))
const selectedLabel = $derived(
  allItems.find((i) => i.value === value)?.label ?? placeholder,
)

function pick(v: string) {
  value = v
  onchange?.(v)
  open = false
}

// קלאסים ל-trigger. ב-Popover.Trigger (קומפוננטה) אי אפשר class: directive,
// לכן בונים מחרוזת אחת שמשמשת את שני המצבים.
const triggerClass = $derived(
  "rounded-xl px-3 py-2.5 text-sm border flex items-center gap-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed" +
    (compact ? "" : " w-full justify-between"),
)
</script>

<!-- ───────── snippets משותפים ───────── -->

{#snippet triggerInner()}
  <span class="truncate min-w-0">{selectedLabel}</span>
  <ChevronDownIcon size={15} style="color:var(--fg-dim)" class="shrink-0" />
{/snippet}

{#snippet list(withSticky: boolean)}
  <div class="flex flex-col overflow-y-auto px-2 pb-3">
    {#each renderGroups as g (g.group)}
      {#if g.group}
        <!-- כותרת קבוצה sticky — נשארת גלויה בגלילה (רק כשהמיכל גולל, כלומר ב-Dialog) -->
        <div
          class:sticky={withSticky}
          class:top-0={withSticky}
          class="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide"
          style="background:var(--bg-elev); color:var(--fg-muted)"
        >
          {g.group}
        </div>
      {/if}
      {#each g.items as item (item.value)}
        <button
          type="button"
          disabled={item.disabled}
          class="rounded-lg px-3 py-3 text-sm flex items-center justify-between text-start disabled:opacity-40"
          style="color:var(--fg)"
          class:is-selected={item.value === value}
          onclick={() => pick(item.value)}
        >
          <span class="truncate min-w-0">{item.label}</span>
          {#if item.value === value}
            <CheckIcon size={18} style="color:var(--accent)" class="shrink-0" />
          {/if}
        </button>
      {/each}
    {/each}
  </div>
{/snippet}

<!-- ───────── מובייל: Dialog ממורכז ───────── -->
{#if responsive.isMobile}
  <button
    type="button"
    {disabled}
    aria-label={ariaLabel ?? title}
    class={triggerClass}
    style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
    onclick={() => (open = true)}
  >
    {@render triggerInner()}
  </button>

  <Dialog.Root bind:open>
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-40 bg-black/60" />
      <Dialog.Content
        class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-sm max-h-[70dvh] flex flex-col rounded-2xl border shadow-xl"
        style="background:var(--bg-elev); border-color:var(--border)"
      >
        <div class="flex flex-col min-h-0">
          {#if title}
            <Dialog.Title
              class="px-4 pt-4 pb-2 text-sm font-semibold shrink-0"
              style="color:var(--fg-dim)"
            >
              {title}
            </Dialog.Title>
          {/if}
          {@render list(true)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>

<!-- ───────── דסקטופ: Popover מעוגן ───────── -->
{:else}
  <Popover.Root bind:open>
    <Popover.Trigger
      {disabled}
      aria-label={ariaLabel ?? title}
      class={triggerClass}
      style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
    >
      {@render triggerInner()}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        sideOffset={6}
        align="start"
        class="z-50 max-h-[60dvh] min-w-[var(--bits-floating-anchor-width)] flex flex-col rounded-xl border shadow-xl overflow-hidden"
        style="background:var(--bg-elev); border-color:var(--border)"
      >
        {@render list(false)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  .is-selected {
    background: var(--bg-card);
  }
</style>
