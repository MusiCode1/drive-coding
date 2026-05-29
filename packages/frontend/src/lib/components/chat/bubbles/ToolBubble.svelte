<script lang="ts">
/**
 * ToolBubble — תצוגה מתקפלת של קריאה לכלי (tool call).
 *
 * מצב מקופל (ברירת מחדל): נקודת סטטוס + קריינות בעברית (או טקסט טעינה)
 * + כותרת טכנית קטנה למטה. קליק בכל מקום → פתיחה.
 *
 * מצב פתוח: אותה כותרת + פאנלים של args/result עם dir="ltr".
 *
 * Slice 4: הקריינות מגיעה אסינכרונית (~1-2 שניות לאחר הסיום). ב-Svelte 5
 * $derived מרנדר מחדש אוטומטית כאשר כותבים חזרה ל-bubble.toolCall.narration.
 *
 * לחיצה מתבצעת על כל המיכל של ה-<button>, ולא על <details> מקונן, כך שהטקסט
 * בתוך ה-pre עדיין ניתן לבחירה (משתמשים ב-stopPropagation על אזור הפרטים).
 */
import type { ToolBubble, ToolCall } from "$lib/types/bubble"
import { getI18n } from "$lib/context"
import { formatToolInput, prettyJson, formatLocation } from "$lib/util/tool-format"

let { bubble }: { bubble: ToolBubble } = $props()
let expanded = $state(false)

const t = getI18n().t
const tc = $derived(bubble.toolCall)
const showNarration = $derived(tc.narration !== undefined && tc.narration.length > 0)
const input = $derived(formatToolInput(tc.args))
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
      <!-- INPUT -->
      {#if input.kind === "command"}
        <div class="section">
          <div class="section-label">{t("chat.tool.args")}</div>
          <pre class="cmd">$ {input.command}</pre>
        </div>
      {:else if input.kind === "json"}
        <div class="section">
          <div class="section-label">{t("chat.tool.args")}</div>
          <pre>{input.json}</pre>
        </div>
      {/if}

      <!-- LOCATIONS -->
      {#if tc.locations && tc.locations.length > 0}
        <div class="section">
          <div class="section-label">{t("chat.tool.locations")}</div>
          <ul class="locations">
            {#each tc.locations as loc}
              <li>{formatLocation(loc)}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- CONTENT (ACP canonical) -->
      {#if tc.content && tc.content.length > 0}
        <div class="section">
          <div class="section-label">{t("chat.tool.content")}</div>
          {#each tc.content as c}
            {#if c.type === "text"}
              <pre>{c.text}</pre>
            {:else if c.type === "diff"}
              <div class="diff">
                <div class="diff-path">{c.path}</div>
                {#if c.oldText}<pre class="removed">{c.oldText}</pre>{/if}
                <pre class="added">{c.newText}</pre>
              </div>
            {:else if c.type === "terminal"}
              <div class="terminal-ref">{t("chat.tool.terminal")}: {c.terminalId}</div>
            {:else}
              <pre>{prettyJson(c.raw)}</pre>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- RAW OUTPUT (collapsible fallback — always available) -->
      {#if tc.result !== undefined}
        <details class="raw-output">
          <summary>{t("chat.tool.raw")}</summary>
          <pre>{prettyJson(tc.result)}</pre>
        </details>
      {/if}
    </div>
  {/if}

  <!-- כופה ריאקטיביות של Svelte עם הגעת הקריינות (slice 4) -->
  <span class="hidden">{tc.narration ?? ""}{tc.status}</span>
</div>

<style>
  .bubble {
    padding: 0.6rem 0.9rem;
    border-radius: 10px;
    line-height: 1.4;
  }

  .bubble-tool {
    /* רוחב מלא לפי מפרט ה-frontend סעיף §7 */
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

  /* נקודות סטטוס (Status dots) */
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

  .cmd {
    color: #4ade80; /* light green */
  }

  .locations {
    list-style: none;
    padding: 0;
    margin: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    opacity: 0.8;
  }

  .locations li {
    margin-bottom: 2px;
  }

  .diff {
    margin-bottom: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .diff-path {
    background: var(--bg-elev);
    padding: 2px 0.5rem;
    font-size: 0.7rem;
    font-family: ui-monospace, monospace;
    border-bottom: 1px solid var(--border);
    opacity: 0.8;
  }

  .diff pre {
    border-radius: 0;
    background: transparent;
  }

  .diff .removed {
    background: rgba(239, 68, 68, 0.15); /* red tint */
    color: #f87171;
  }

  .diff .added {
    background: rgba(34, 197, 94, 0.15); /* green tint */
    color: #4ade80;
  }

  .terminal-ref {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    opacity: 0.7;
    font-style: italic;
  }

  .raw-output {
    margin-top: 0.8rem;
  }

  .raw-output summary {
    font-size: 0.7rem;
    opacity: 0.5;
    cursor: pointer;
    user-select: none;
    outline: none;
    text-transform: uppercase;
  }

  .raw-output summary:hover {
    opacity: 0.8;
  }

  .raw-output[open] summary {
    margin-bottom: 4px;
  }

  .hidden {
    display: none;
  }
</style>
