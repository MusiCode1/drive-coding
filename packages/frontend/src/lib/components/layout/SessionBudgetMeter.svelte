<script lang="ts">
/**
 * SessionBudgetMeter — trigger קטן בהדר שמציג אחוז ניצול חלון-הקונטקסט.
 *
 * slice session-budget-meter, Commit 5.
 *
 * מופיע רק כש-`session.contextUsage` תקין ו-`size>0` (brief §4 Commit 5 UI contract).
 * לחיצה פותחת popover read-only (SessionBudgetPopover) עם ACP context + quota רב-ספקי.
 * open → session.refreshQuota() (on-open, לא polling — brief §9 Q4).
 *
 * ה-UI כאן אגנוסטי לספק לחלוטין — לא מכיר Claude/Codex/שמות חלונות.
 */
import { Popover } from "bits-ui"
import { getI18n, getSession } from "$lib/context"
import SessionBudgetPopover from "./SessionBudgetPopover.svelte"

const session = getSession()
const t = getI18n().t

let open = $state(false)

// מופיע רק עם contextUsage תקין ו-size>0 (brief §4 Commit 5 UI contract).
const visible = $derived(session.contextUsage !== null && session.contextUsage.size > 0)

// round(used/size*100) עם clamp ל-0..100.
const percent = $derived.by(() => {
  const usage = session.contextUsage
  if (usage === null || usage.size <= 0) return 0
  const raw = Math.round((usage.used / usage.size) * 100)
  return Math.min(100, Math.max(0, raw))
})

function handleOpenChange(next: boolean): void {
  open = next
  if (next) void session.refreshQuota()
}
</script>

{#if visible}
  <Popover.Root bind:open onOpenChange={handleOpenChange}>
    <Popover.Trigger
      class="pointer-events-auto shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono outline-none"
      style="background:var(--bg-card); border:1px solid var(--border); color:var(--fg)"
      aria-label={t("sessionBudget.trigger")}
    >
      <span dir="ltr">{percent}%</span>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        sideOffset={6}
        align="end"
        class="z-50 w-72 max-w-[92vw] max-h-[70dvh] overflow-y-auto rounded-xl border shadow-xl p-3"
        style="background:var(--bg-elev); border-color:var(--border)"
      >
        <SessionBudgetPopover />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}
