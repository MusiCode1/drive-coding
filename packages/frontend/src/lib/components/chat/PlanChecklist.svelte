<script lang="ts">
/**
 * PlanChecklist — צ'קליסט חי ונעוץ של תוכנית-העבודה (claude TodoWrite / codex update_plan).
 *
 * לא חלק מ-session.bubbles — מרונדר מעל הרשימה הווירטואלית (תבנית StatusBubble.svelte:
 * אלמנט נעוץ שאינו בועה). visible רק כש-planStore.order.length>0 — ספק שלא שולח `plan`
 * (כל ספק חוץ מ-claude, נכון ל-2026-07) פשוט לא מציג את הרכיב, בלי הנחה.
 *
 * ─── slice plan-todo-list Commit 2 ───
 */

import CircleIcon from "@lucide/svelte/icons/circle"
import CircleCheckBigIcon from "@lucide/svelte/icons/circle-check-big"
import CircleDotIcon from "@lucide/svelte/icons/circle-dot"
import FileTextIcon from "@lucide/svelte/icons/file-text"
import { getContentViewer, getI18n, getSession } from "$lib/context"

const session = getSession()
const t = getI18n().t
const viewer = getContentViewer()

// Svelte-5 reactivity: planStore מוחלף כאובייקט חדש (immutable) ב-reducePlan — קריאת
// .length כאן מזהה את ההחלפה (ר' brief §6).
const visible = $derived(session.planStore.order.length > 0)

function openMarkdown(content: string): void {
  viewer.show({ kind: "markdown", text: content, title: t("plan.title") })
}
</script>

{#if visible}
  <div class="plan-checklist" role="status" aria-live="polite">
    <div class="plan-title">{t("plan.title")}</div>

    {#each session.planStore.order as planId (planId)}
      {@const item = session.planStore.byId[planId]}
      {#if item?.kind === "entries"}
        <ul class="plan-entries">
          {#each item.entries as entry, idx (entry.content + idx)}
            <li class="plan-entry status-{entry.status} priority-{entry.priority ?? 'medium'}">
              <span class="plan-icon" aria-label={t(`plan.status.${entry.status}`)}>
                {#if entry.status === "completed"}
                  <CircleCheckBigIcon size={14} strokeWidth={2} />
                {:else if entry.status === "in_progress"}
                  <CircleDotIcon size={14} strokeWidth={2} />
                {:else}
                  <CircleIcon size={14} strokeWidth={2} />
                {/if}
              </span>
              <span class="plan-content" dir="auto">{entry.content}</span>
            </li>
          {/each}
        </ul>
      {:else if item?.kind === "markdown"}
        <!-- PlanMarkdown → content-viewer הקיים (הצגת "בריף" לאישור) -->
        <button class="plan-markdown-btn" onclick={() => openMarkdown(item.content)}>
          <FileTextIcon size={13} strokeWidth={2} />
          {t("plan.openMarkdown")}
        </button>
      {:else if item?.kind === "file"}
        <!-- PlanFile: slice fs-file-proxy — כפתור "צפה" פותח ContentViewer (במקום placeholder) -->
        <div class="plan-file" dir="auto">
          <FileTextIcon size={13} strokeWidth={2} />
          <span>{t("plan.file.label")}:</span>
          <span class="plan-file-uri" dir="ltr">{item.uri}</span>
          <button
            type="button"
            class="plan-file-view-btn"
            onclick={() => viewer.show({ kind: "file", uri: item.uri })}
          >
            {t("plan.file.view")}
          </button>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .plan-checklist {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.85rem;
    border-radius: 0.75rem;
    font-size: 0.8rem;
    color: var(--fg-dim);
    background: var(--bg-card);
    border: 1px solid var(--border);
    align-self: flex-end; /* בצד הסוכן — תואם StatusBubble */
    max-width: 78%;
    min-width: 0;
  }

  .plan-title {
    font-size: 0.7rem;
    font-weight: 600;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .plan-entries {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .plan-entry {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    min-width: 0;
    padding-inline-start: 0.45rem;
    border-inline-start: 2px solid transparent; /* priority tint עדין — §4 עקרונות רינדור */
  }
  .plan-entry.priority-high {
    border-inline-start-color: #f97316;
  }
  .plan-entry.priority-low {
    border-inline-start-color: var(--border);
  }

  .plan-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    margin-top: 0.1rem;
    color: var(--fg-dim);
  }
  .plan-entry.status-in_progress .plan-icon {
    color: #f97316;
    animation: pulse 1.4s ease-in-out infinite;
  }
  .plan-entry.status-completed .plan-icon {
    color: #22c55e;
  }

  .plan-content {
    min-width: 0;
    word-break: break-word;
    color: var(--fg);
  }
  .plan-entry.status-completed .plan-content {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .plan-entry.status-pending .plan-content {
    opacity: 0.75;
  }

  .plan-markdown-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    align-self: flex-start;
    padding: 0.3rem 0.6rem;
    border-radius: 0.5rem;
    font-size: 0.78rem;
    color: var(--fg-dim);
    background: var(--bg-elev, var(--bg));
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .plan-markdown-btn:hover {
    color: var(--fg);
  }

  .plan-file {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    opacity: 0.85;
  }
  .plan-file-uri {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    opacity: 0.8;
    word-break: break-all;
  }

  /* slice fs-file-proxy — כפתור "צפה", אותה תבנית כמו .plan-markdown-btn */
  .plan-file-view-btn {
    padding: 0.15rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.72rem;
    color: var(--fg-dim);
    background: var(--bg-elev, var(--bg));
    border: 1px solid var(--border);
    cursor: pointer;
    flex-shrink: 0;
  }
  .plan-file-view-btn:hover {
    color: var(--fg);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
</style>
