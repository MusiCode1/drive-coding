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
 * Select — בורר מותאם-מובייל. Trigger קומפקטי שפותח Dialog ממורכז (Bits)
 * עם רשימה גלילה, במקום ה-popup הנייטיב של מערכת ההפעלה (שמעצבן ב-Android).
 *
 * הוחלף ב-redesign-fix: היה native <select> מעוצב (החלטת redesign-3). ה-Dialog
 * הממורכז צף מעל הכל — לא מתנגש עם ה-BottomSheet (בניגוד ל-popover מעוגן).
 *
 * תומך flat (options) או מקובץ-לקטגוריות (groups, עם כותרות-קבוצה sticky).
 *
 * שימוש:
 *   <Select bind:value options={[{value,label}]} title="בחר…" />
 *   <Select bind:value groups={[{group, items:[…]}]} title="בחר…" />
 *
 * ─── ui · redesign-fix ───
 */
import { Dialog } from "bits-ui"
import CheckIcon from "@lucide/svelte/icons/check"
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down"

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
</script>

<button
  type="button"
  {disabled}
  aria-label={ariaLabel ?? title}
  class="rounded-xl px-3 py-2.5 text-sm border flex items-center gap-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
  class:w-full={!compact}
  class:justify-between={!compact}
  style="background:var(--bg-card); border-color:var(--border); color:var(--fg)"
  onclick={() => (open = true)}
>
  <span class="truncate min-w-0">{selectedLabel}</span>
  <ChevronDownIcon size={15} style="color:var(--fg-dim)" class="shrink-0" />
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
        <div class="flex flex-col overflow-y-auto px-2 pb-3">
          {#each renderGroups as g (g.group)}
            {#if g.group}
              <!-- כותרת קבוצה sticky — נשארת גלויה בגלילה -->
              <div
                class="sticky top-0 px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide"
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
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .is-selected {
    background: var(--bg-card);
  }
</style>
