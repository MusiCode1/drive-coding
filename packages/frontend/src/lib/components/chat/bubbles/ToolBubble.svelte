<script lang="ts">
/**
 * ToolBubble — כלי, עיצוב מחדש (C2).
 *
 * self-end + max-w-[78%] (לא stretch). avatar tool.
 * status dot: ירוק=completed, כתום-פועם=in_progress.
 * drill-down: summary (narration) → <details> עם args+result (native details — לפי §9 Q4).
 * שמירת content/locations מ-slice 16.
 *
 * מוקאפ: 280-291.
 *
 * ─── redesign-5 (C2) ───
 */
import type { ToolBubble, ToolCall } from "$lib/types/bubble"
import { getI18n } from "$lib/context"
import { formatToolInput, prettyJson, formatLocation } from "$lib/util/tool-format"
import Avatar from "$lib/components/chat/Avatar.svelte"

let { bubble }: { bubble: ToolBubble } = $props()
const t = getI18n().t

const tc = $derived(bubble.toolCall)
const showNarration = $derived(tc.narration !== undefined && tc.narration.length > 0)
const input = $derived(formatToolInput(tc.args))
</script>

<div class="flex gap-2 self-end max-w-[78%] min-w-0 items-end flex-row-reverse">
  <Avatar kind="tool" />

  <div
    class="rounded-xl border overflow-hidden text-[13px] flex-1 min-w-0"
    style="background:var(--bg-card); border-color:var(--border)"
  >
    <!-- summary שורה: status dot + narration/title -->
    <details class="group">
      <summary class="flex items-center gap-2 px-3 py-2 cursor-pointer list-none select-none">
        <!-- status dot -->
        <span
          class="size-2 rounded-full shrink-0 status-{tc.status}"
          aria-label={t(`chat.tool.status.${tc.status}`)}
        ></span>

        <!-- narration או title -->
        <div class="flex-1 min-w-0" style="color:var(--fg-dim)">
          {#if showNarration}
            <div class="truncate" dir="auto">{tc.narration}</div>
          {:else if tc.title}
            <div class="truncate font-mono text-[11px]" dir="ltr">{tc.title}</div>
          {:else}
            <div class="opacity-40 italic">{t("chat.tool.loading_narration")}</div>
          {/if}
        </div>

        <span class="text-[10px] opacity-50 transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
      </summary>

      <!-- פרטים: args + result + content + locations -->
      <div class="border-t flex flex-col gap-1.5 px-3 py-2" style="border-color:var(--border)" dir="ltr">
        <!-- args -->
        {#if input.kind === "command"}
          <div>
            <div class="section-label">{t("chat.tool.args")}</div>
            <pre class="cmd">$ {input.command}</pre>
          </div>
        {:else if input.kind === "json"}
          <div>
            <div class="section-label">{t("chat.tool.args")}</div>
            <pre>{input.json}</pre>
          </div>
        {/if}

        <!-- locations (slice 16) -->
        {#if tc.locations && tc.locations.length > 0}
          <div>
            <div class="section-label">{t("chat.tool.locations")}</div>
            <ul class="font-mono text-[11px] opacity-80 list-none p-0 m-0">
              {#each tc.locations as loc}
                <li>{formatLocation(loc)}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- content (slice 16) -->
        {#if tc.content && tc.content.length > 0}
          <div>
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
                <div class="terminal-ref font-mono text-[11px] opacity-70 italic">
                  {t("chat.tool.terminal")}: {c.terminalId}
                </div>
              {:else}
                <pre>{prettyJson(c.raw)}</pre>
              {/if}
            {/each}
          </div>
        {/if}

        <!-- raw output (always available as fallback) -->
        {#if tc.result !== undefined}
          <details class="raw-output">
            <summary class="section-label cursor-pointer">{t("chat.tool.raw")}</summary>
            <pre>{prettyJson(tc.result)}</pre>
          </details>
        {/if}
      </div>
    </details>

    <!-- כופה ריאקטיביות -->
    <span class="hidden">{tc.narration ?? ""}{tc.status}</span>
  </div>
</div>

<style>
  .status-pending    { background: var(--fg-dim, #888); }
  .status-in_progress { background: #f97316; animation: pulse 1s ease-in-out infinite; }
  .status-completed  { background: #22c55e; }
  .status-failed     { background: #ef4444; }

  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

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
    background: var(--bg);
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
  }

  .cmd { color: #4ade80; }

  .diff { border: 1px solid var(--border); border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem; }
  .diff-path { background: var(--bg-elev); padding: 2px 0.5rem; font-size: 0.7rem; font-family: ui-monospace, monospace; border-bottom: 1px solid var(--border); opacity: 0.8; }
  .diff pre { border-radius: 0; background: transparent; }
  .diff .removed { background: rgba(239,68,68,0.15); color: #f87171; }
  .diff .added { background: rgba(34,197,94,0.15); color: #4ade80; }

  .terminal-ref { font-family: ui-monospace, monospace; font-size: 0.75rem; }

  .raw-output summary { list-style: none; }
  .raw-output[open] summary { margin-bottom: 4px; }

  .hidden { display: none; }
</style>
