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

/** portal — מעביר את הצומת ל-document.body בעת mount, ומחזיר אותו במקומו ב-destroy. */
function portal(node: HTMLElement) {
  document.body.appendChild(node)
  return {
    destroy() {
      node.remove()
    },
  }
}
</script>

<ul
  use:portal
  class="fixed max-h-64 overflow-y-auto rounded-xl border shadow-lg z-50"
  style="background:var(--bg-card); border-color:var(--border); top:{rect.top}px; left:{rect.left}px; width:{rect.width}px; transform:translateY(-100%) translateY(-0.25rem)"
  aria-label={t("slash.commandsList")}
>
  {#each matches as cmd, i (cmd.name)}
    <li>
      <button
        type="button"
        class="w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5"
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
          <span class="truncate text-xs" style="color:var(--fg-dim)">{cmd.description}</span>
        {/if}
      </button>
    </li>
  {/each}
</ul>
