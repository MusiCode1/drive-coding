<script lang="ts">
/**
 * SubagentBubble — container חי לבועת Task/תת-סוכן (slice subagent-transcript-render, B2).
 *
 * props-only — לא מייבא VM, לא עושה parsing. מקבל `bubble: ToolBubble` (עם `subFrames`/`task`
 * שB1 מאכלס). ר' §4 architecture: reuse ל-BubbleRenderer לרינדור ה-subFrames (depth guard).
 *
 * MVP-scope (§1): B1 משטח כל תוכן תת-סוכן ל-MessageBubble יחיד (thinking/tool_use/tool_result
 * כטקסט). הבחנה ויזואלית פר-סוג = B (per-kind) עתידי — הרנדרר כאן כבר תומך בכך בחינם (reuse).
 *
 * ─── slice/subagent-transcript-render (Commit 1) — header + transcript region בסיסי ───
 */
import type { ToolBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"
import Avatar from "$lib/components/chat/Avatar.svelte"
import BubbleRenderer from "$lib/components/chat/BubbleRenderer.svelte"

let { bubble, depth = 0 }: { bubble: ToolBubble; depth?: number } = $props()

const t = getI18n().t

// finding #5 — הכרז derives
const tc = $derived(bubble.toolCall)
// finding #1 — task הוא TaskMeta | undefined; אל תפרק ישירות
const task = $derived(bubble.toolCall.task)
const frames = $derived(bubble.subFrames ?? [])
// finding #4 — status עם fallback ל-"unknown" (task אולי undefined)
const status = $derived(task?.status ?? "unknown")
const heading = $derived(task?.subagentType ?? tc.name)

// local state — פתוח בזמן ריצה, מאותחל פעם אחת (§5 Commit 2 מרחיב ל-no-snapback).
let open = $state(true)
</script>

<div class="flex gap-2 self-end max-w-[85%] min-w-0 items-end flex-row-reverse">
  <Avatar kind="tool" />

  <div
    class="rounded-xl border overflow-hidden text-[13px] flex-1 min-w-0"
    style="background:var(--bg-card); border-color:var(--border)"
  >
    <details bind:open>
      <summary class="flex items-center gap-2 px-3 py-2 cursor-pointer list-none select-none">
        <span
          class="size-2 rounded-full shrink-0 status-{status}"
          aria-label={t(`chat.subagent.status.${status}`)}
        ></span>

        <div class="flex-1 min-w-0" style="color:var(--fg-dim)">
          <div class="truncate font-semibold" dir="auto">{heading}</div>
          {#if task?.prompt}
            <div class="truncate text-[11px] opacity-80" dir="auto">{task.prompt}</div>
          {/if}
        </div>

        <span class="text-[10px] opacity-50 transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
      </summary>

      <div class="transcript-region border-t px-3 py-2" style="border-color:var(--border)">
        {#each frames as sf (sf.id)}
          <BubbleRenderer bubble={sf} depth={depth + 1} />
        {/each}
        <!-- finding #6 — כפיית reactivity על מערך subFrames (object-replacement של B1) -->
        <span class="hidden">{frames.length}</span>
      </div>
    </details>
  </div>
</div>

<style>
  .status-pending     { background: var(--fg-dim, #888); }
  .status-in_progress { background: #f97316; animation: pulse 1s ease-in-out infinite; }
  .status-completed   { background: #22c55e; }
  .status-failed      { background: #ef4444; }
  .status-unknown     { background: var(--fg-dim); }

  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  .transcript-region {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .hidden { display: none; }
</style>
