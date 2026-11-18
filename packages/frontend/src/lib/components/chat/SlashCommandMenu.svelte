<script lang="ts">
/**
 * SlashCommandMenu — רשימת-השלמה של פקודות-slash, ממוקמת fixed מעל ה-textarea.
 * (slice-slash-commands, Commit 2)
 *
 * רכיב-leaf דק: מקבל matches/selectedIndex/onselect/rect מ-TypeArea (state
 * management ב-parent). name/description/hint הם data מהספק (אנגלית דינמית) —
 * לא מתורגמים; רק ה-aria-label של הרשימה עצמה עובר t().
 *
 * **portal ל-document.body**: ה-textarea יושב בתוך `.record-pane-inner` שיש לה
 * `overflow:hidden` (נחוץ לאנימציית-הקיפול של הפוטר — RecordFooter.svelte).
 * position:absolute רגיל היה נחתך שם ובלתי-נראה (נתפס ב-verification ידני
 * בדפדפן — הרשימה הייתה קיימת ב-DOM אך invisible וקליקים נפלו על chat-scroll
 * שמתחתיה). הפתרון: portal ידני ל-body + position:fixed עם קואורדינטות
 * viewport-relative (מ-getBoundingClientRect ב-TypeArea) — בורח גם מה-clip
 * וגם מ-containing-block של position:fixed שיוצר ancestor עם transform
 * (BottomSheet במובייל).
 *
 * **listbox parity** (slice-slash-menu-native, Commit 1): scroll-into-view של
 * הפריט המודגש (הרשימה `max-h-64` נגללת, ניווט-חיצים לבדו לא גולל) + ARIA
 * מלא (`role=listbox` על ה-ul עם id יציב, `role=option`/`aria-selected`/id
 * פר-`<button>` — לא על ה-`<li>`, כי option שמכיל אלמנט אינטראקטיבי הוא
 * ARIA anti-pattern; ה-`<button>` הוא האלמנט הנבחר/הקליקבילי).
 */
import type { AvailableCommand } from "@agentclientprotocol/sdk"
import { getI18n } from "$lib/context"

let {
  matches,
  selectedIndex,
  onselect,
  rect,
}: {
  matches: AvailableCommand[]
  selectedIndex: number
  onselect: (cmd: AvailableCommand) => void
  rect: { top: number; left: number; width: number }
} = $props()

const t = getI18n().t

let ulEl = $state<HTMLUListElement>()

/** portal — מעביר את הצומת ל-document.body בעת mount, ומחזיר אותו במקומו ב-destroy. */
function portal(node: HTMLElement) {
  document.body.appendChild(node)
  return {
    destroy() {
      node.remove()
    },
  }
}

// listbox parity: גולל את הפריט המודגש לתצוגה בכל שינוי-selectedIndex (או
// כשרשימת ה-matches עצמה משתנה, כי selectedIndex עשוי להישאר 0 בזמן שהפריט-0
// החדש טרם נראה). block:"nearest" — גולל רק את ה-<ul> (scroll-container הקרוב),
// לא את הדף כולו.
$effect(() => {
  selectedIndex
  matches
  const ul = ulEl
  if (!ul) return
  const el = ul.querySelector(`[data-index="${selectedIndex}"]`)
  el?.scrollIntoView({ block: "nearest" })
})
</script>

<ul
  bind:this={ulEl}
  use:portal
  role="listbox"
  id="slash-listbox"
  class="fixed max-h-64 overflow-y-auto rounded-xl border shadow-lg z-50"
  style="background:var(--bg-card); border-color:var(--border); top:{rect.top}px; left:{rect.left}px; width:{rect.width}px; transform:translateY(-100%) translateY(-0.25rem)"
  aria-label={t("slash.commandsList")}
>
  {#each matches as cmd, i (cmd.name)}
    <li>
      <button
        type="button"
        role="option"
        id="slash-opt-{i}"
        data-index={i}
        aria-selected={i === selectedIndex}
        dir="ltr"
        class="w-full text-start px-3 py-2 text-sm flex flex-col gap-0.5"
        style={i === selectedIndex ? "background:color-mix(in srgb, var(--accent) 18%, transparent)" : ""}
        onclick={() => onselect(cmd)}
      >
        <span class="flex items-baseline gap-1.5 min-w-0">
          <span class="font-semibold shrink-0" style="color:var(--fg)">/{cmd.name}</span>
          {#if cmd.input?.hint}
            <span class="min-w-0 truncate font-mono text-xs" style="color:var(--fg-muted)">{cmd.input.hint}</span>
          {/if}
        </span>
        {#if cmd.description}
          <!-- dir=auto: description flows by its own content (Hebrew→RTL, English→LTR) while the
               item layout stays LTR-structured (command name → hint). -->
          <span dir="auto" class="truncate text-xs" style="color:var(--fg-dim)">{cmd.description}</span>
        {/if}
      </button>
    </li>
  {/each}
</ul>
