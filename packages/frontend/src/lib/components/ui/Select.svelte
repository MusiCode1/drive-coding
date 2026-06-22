<script lang="ts" module>
export interface SelectOption {
  value: string
  label: string
  /** תיאור אופציונלי — מוצג מתחת ל-label ברשימה, ומתחת ל-trigger לבחירה הנוכחית. */
  description?: string | null
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

// תקציר: השורה הראשונה בלבד של ה-description (התיאורים מה-CLI רב-שורתיים — השורה
// הראשונה היא התקציר). חיתוך נוסף ל-2 שורות נעשה ב-CSS (line-clamp).
function firstLine(d?: string | null): string {
  if (!d) return ""
  const line = d.split("\n")[0]
  return line ? line.trim() : ""
}

// תיאור הבחירה הנוכחית — מוצג מתחת ל-trigger (ריק → לא מוצג, no-op לבוררים בלי תיאור).
const selectedDescription = $derived(
  firstLine(allItems.find((i) => i.value === value)?.description),
)
// התיאור המלא (כל השורות) — נחשף ב-hover (title) וב-expand (לחיצה).
const selectedDescriptionFull = $derived(
  (allItems.find((i) => i.value === value)?.description ?? "").trim(),
)
// יש מה לפרוס: יותר משורה אחת (רב-שורתי), או שורה ראשונה ארוכה (כנראה נחתכת ב-clamp).
const canExpandDesc = $derived(
  selectedDescriptionFull !== selectedDescription || selectedDescription.length > 45,
)
// מצב פריסת התיאור (מחוץ ל-dropdown). לחיצה = toggle.
let descExpanded = $state(false)
// איפוס הפריסה כשמחליפים בחירה — אחרת נשאר פרוס על תיאור שכבר לא רלוונטי.
$effect(() => {
  void value
  descExpanded = false
})

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
  <span class="truncate min-w-0" dir="auto">{selectedLabel}</span>
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
          class="rounded-lg px-3 py-3 text-sm flex items-start justify-between gap-2 text-start hover:bg-white/5 disabled:opacity-40"
          style="color:var(--fg)"
          class:is-selected={item.value === value}
          onclick={() => pick(item.value)}
        >
          <span class="flex flex-col min-w-0 gap-0.5">
            <span class="line-clamp-2 text-start" dir="auto">{item.label}</span>
            {#if firstLine(item.description)}
              <span class="line-clamp-2 text-[11px] leading-snug text-start" style="color:var(--fg-dim)" dir="auto">{firstLine(item.description)}</span>
            {/if}
          </span>
          {#if item.value === value}
            <CheckIcon size={18} style="color:var(--accent)" class="shrink-0 mt-0.5" />
          {/if}
        </button>
      {/each}
    {/each}
  </div>
{/snippet}

<!-- עטיפה: trigger + תיאור הבחירה הנוכחית מתחתיו (description לכל בורר) -->
<div class="flex flex-col gap-1 min-w-0">

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
        class="z-50 max-h-[60dvh] w-(--bits-floating-anchor-width) max-w-[92vw] flex flex-col rounded-xl border shadow-xl overflow-hidden"
        style="background:var(--bg-elev); border-color:var(--border)"
      >
        {@render list(false)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

  <!-- תיאור הבחירה הנוכחית — פונט קטן. כשהתיאור חתוך: לחיצה פורסת/מקפלת (toggle),
       ובדסקטופ hover מציג tooltip (title) עם המלא. תיאור קצר → span רגיל ללא אפשרות פריסה. -->
  {#if selectedDescription}
    {#if canExpandDesc}
      <button
        type="button"
        class="px-1 text-[11px] leading-snug text-start flex items-start gap-1 cursor-pointer outline-none"
        style="color:var(--fg-dim)"
        aria-expanded={descExpanded}
        title={descExpanded ? undefined : selectedDescriptionFull}
        onclick={() => (descExpanded = !descExpanded)}
      >
        <span class="min-w-0 {descExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}" dir="auto"
          >{descExpanded ? selectedDescriptionFull : selectedDescription}</span>
        <ChevronDownIcon
          size={12}
          class="shrink-0 mt-0.5 transition-transform"
          style="transform:rotate({descExpanded ? 180 : 0}deg)"
        />
      </button>
    {:else}
      <span class="px-1 text-[11px] leading-snug line-clamp-2" style="color:var(--fg-dim)" dir="auto">{selectedDescription}</span>
    {/if}
  {/if}
</div>

<style>
  .is-selected {
    background: var(--bg-card);
  }
</style>
