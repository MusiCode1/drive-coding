<script lang="ts">
/**
 * ToolBubble — collapsible tool call display.
 *
 * Collapsed (default): status dot + Hebrew narration (or loading placeholder)
 * + technical title small below. Click anywhere → expand.
 *
 * Expanded: same header + args/result panels dir="ltr".
 *
 * Slice 4: narration arrives async (~1-2s after completed). Svelte 5 $derived
 * re-renders automatically when bubble.toolCall.narration is written back.
 *
 * Click is on the whole <button> container, not a nested <details>, so text
 * inside pre is still selectable (stopPropagation on the details section).
 */
import type { ToolBubble, ToolCall } from "$lib/types/bubble"
import { getI18n } from "$lib/context"

let { bubble }: { bubble: ToolBubble } = $props()
let expanded = $state(false)

const t = getI18n().t
const tc = $derived(bubble.toolCall)
const showNarration = $derived(tc.narration !== undefined && tc.narration.length > 0)

function formatResult(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>

<div class="bubble bubble-tool" class:expanded>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="header"
    role="button"
    tabindex="0"
    onclick={() => (expanded = !expanded)}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        expanded = !expanded
      }
    }}
    aria-expanded={expanded}
  >
    <span class="status-dot status-{tc.status}" aria-label={t(`chat.tool.status.${tc.status}`)}></span>
    <div class="header-text">
      {#if showNarration}
        <div class="narration" dir="auto">{tc.narration}</div>
      {:else}
        <div class="narration loading">{t("chat.tool.loading_narration")}</div>
      {/if}
      {#if tc.title}
        <div class="title" dir="ltr">{tc.title}</div>
      {/if}
    </div>
    <span class="arrow" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
  </div>

  {#if expanded}
    <div class="details" dir="ltr" role="presentation" onclick={(e) => e.stopPropagation()}>
      <div class="section">
        <div class="section-label">{t("chat.tool.args")}</div>
        <pre>{JSON.stringify(tc.args, null, 2)}</pre>
      </div>
      {#if (tc as ToolCall).result !== undefined}
        <div class="section">
          <div class="section-label">{t("chat.tool.result")}</div>
          <pre>{formatResult((tc as ToolCall).result)}</pre>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Pin Svelte reactivity on narration arrival (slice 4) -->
  <span class="hidden">{tc.narration ?? ""}{tc.status}</span>
</div>

<style>
  .bubble {
    padding: 0.6rem 0.9rem;
    border-radius: 10px;
    line-height: 1.4;
  }

  .bubble-tool {
    /* Full width per frontend-spec §7 */
    align-self: stretch;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    cursor: pointer;
    user-select: none;
  }

  .header {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    outline: none;
  }

  .header-text {
    flex: 1;
    min-width: 0;
  }

  .narration {
    font-size: 0.9rem;
    word-wrap: break-word;
  }

  .narration.loading {
    opacity: 0.4;
    font-style: italic;
  }

  .title {
    font-size: 0.75rem;
    opacity: 0.6;
    font-family: ui-monospace, monospace;
    margin-top: 2px;
    word-wrap: break-word;
  }

  .arrow {
    font-size: 0.7rem;
    opacity: 0.6;
    flex-shrink: 0;
    margin-top: 2px;
  }

  /* Status dots */
  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }

  .status-pending {
    background: var(--fg-dim, #888);
  }

  .status-in_progress {
    background: #f97316; /* orange */
    animation: pulse 1s ease-in-out infinite;
  }

  .status-completed {
    background: #22c55e; /* green */
  }

  .status-failed {
    background: #ef4444; /* red */
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .details {
    margin-top: 0.6rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
    user-select: text;
    cursor: auto;
  }

  .section {
    margin-bottom: 0.6rem;
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: 600;
    opacity: 0.6;
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  pre {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 0;
    background: var(--bg-base, #1a1a1a);
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
  }

  .hidden {
    display: none;
  }
</style>
