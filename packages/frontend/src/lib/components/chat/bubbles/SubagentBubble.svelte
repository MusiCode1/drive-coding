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
 * ─── slice/subagent-transcript-render (Commit 2) — max-height+overflow, summary footer, dir ───
 * ─── slice/subagent-transcript-render (Commit 3 / fix) — scroll-intent guard על toggle ───
 */
import type { ToolBubble } from "$lib/types/bubble"
import { getI18n, getChatScroll } from "$lib/context"
import BubbleRenderer from "$lib/components/chat/BubbleRenderer.svelte"
import MarkdownContent from "./MarkdownContent.svelte"
import { onMount } from "svelte"

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

// local state — מאותחל פעם אחת (לא $derived מ-setting) — פתוח בזמן ריצה, נשאר
// לפי בחירת-המשתמש אחרי toggle. מונע snap-back כשה-status/subFrames מתעדכנים
// (תבנית מדויקת מ-ThoughtBubble.svelte).
let open = $state(true)

// ─── toggle-intent (slice chat-virtualization, Commit 3 / fix) ───
// תבנית מדויקת מ-ToolBubble.svelte — chatScroll נקרא ב-component init (חוקי).
// rAF אחרי mount מסנן את ה-toggle-fire הראשוני של <details bind:open> תחת CSR.
const chatScroll = getChatScroll()
let ready = false
onMount(() => requestAnimationFrame(() => { ready = true }))
const onUserToggle = () => { if (ready) chatScroll.noteUserIntent?.() }
</script>

<div
  class="rounded-xl border overflow-hidden text-[13px] min-w-0 max-w-[85%] w-full"
  style="background:var(--bg-card); border-color:var(--border)"
>
    <details bind:open ontoggle={onUserToggle}>
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

      {#if task?.summary}
        <div class="border-t px-3 py-2" style="border-color:var(--border)">
          <div class="section-label">{t("chat.subagent.summary")}</div>
          <MarkdownContent text={task.summary} />
        </div>
      {/if}
    </details>
</div>

<style>
  .status-pending     { background: var(--fg-dim, #888); }
  .status-in_progress { background: #f97316; animation: pulse 1s ease-in-out infinite; }
  .status-completed   { background: #22c55e; }
  .status-failed      { background: #ef4444; }
  .status-unknown     { background: var(--fg-dim); }

  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  .section-label {
    font-size: 0.7rem;
    font-weight: 600;
    opacity: 0.6;
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .transcript-region {
    max-height: 360px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .hidden { display: none; }
</style>
