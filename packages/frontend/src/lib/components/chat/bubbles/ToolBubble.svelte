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
import { getContentViewer, getI18n, getSettings, getChatScroll } from "$lib/context"
import { formatToolInput, prettyJson, formatLocation } from "$lib/util/tool-format"
import { renderMarkdown } from "$lib/util/markdown"
import Maximize2Icon from "@lucide/svelte/icons/maximize-2"
import { onMount } from "svelte"

let { bubble }: { bubble: ToolBubble } = $props()
const t = getI18n().t
const settings = getSettings()
// content-viewer: כפתור expand על text + click על image → lightbox
const viewer = getContentViewer()

const tc = $derived(bubble.toolCall)
const showNarration = $derived(tc.narration !== undefined && tc.narration.length > 0)
const input = $derived(formatToolInput(tc.args))

// local state — מאותחל פעם אחת מה-setting, לא נגזר ממנו reactively.
// מונע snap-back כשה-effect של tc.status/tc.narration רץ מחדש.
let open = $state(settings.showTools)

// ─── toggle-intent (slice chat-virtualization, Commit 3 / fix) ───
// chatScroll נקרא ב-component init (חוקי) — לא בתוך ה-callback.
// guard ל-init-fire: <details bind:open=$state> תחת CSR מתזמן toggle event ב-mount.
// rAF אחרי mount מסנן את ה-fire הראשון (task-from-mount קודם ל-rAF).
const chatScroll = getChatScroll()
let ready = false
onMount(() => requestAnimationFrame(() => { ready = true }))
const onUserToggle = () => { if (ready) chatScroll.noteUserIntent?.() }
</script>

<div
  class="rounded-xl border overflow-hidden text-[13px] min-w-0 max-w-[78%] w-full"
  style="background:var(--bg-card); border-color:var(--border)"
>
    <!-- summary שורה: status dot + narration/title -->
    <details class="group" bind:open ontoggle={onUserToggle}>
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
                <!-- C6: renderMarkdown על פלט טקסטואלי; pre נשאר dir=ltr -->
                <!-- content-viewer: כפתור expand לפתיחת הטקסט fullscreen -->
                <div class="tool-text-wrapper">
                  <div class="tool-text-output" dir="ltr">{@html renderMarkdown(c.text)}</div>
                  <button
                    class="tool-expand-btn"
                    onclick={() => viewer.show({ kind: "markdown", text: c.text })}
                    aria-label={t("contentViewer.expand")}
                    title={t("contentViewer.expand")}
                  >
                    <Maximize2Icon size={11} strokeWidth={2} />
                  </button>
                </div>
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
              {:else if c.type === "image"}
                <!--
                  Invariant אבטחה: תמונות מוצגות **רק** דרך <img>.
                  SVG מותר כי ב-<img> הדפדפן מריץ scripting/external-fetch ב-secure-static-mode (מנוטרל).
                  אם אי-פעם עוברים לרינדור inline ({@html} / <object>) — חובה לחסום image/svg+xml.
                  content-viewer: לחיצה על התמונה פותחת lightbox fullscreen.
                -->
                <button
                  class="tool-image-btn"
                  onclick={() => viewer.show({ kind: "image", src: `data:${c.mimeType};base64,${c.data}`, alt: t("chat.tool.content") })}
                  aria-label={t("contentViewer.expand")}
                  title={t("contentViewer.expand")}
                >
                  <img
                    class="tool-image"
                    src={`data:${c.mimeType};base64,${c.data}`}
                    alt={t("chat.tool.content")}
                    loading="lazy"
                  />
                </button>
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

  /* C6: markdown בפלט טקסטואלי של כלי */
  .tool-text-output {
    font-size: 0.78rem;
    line-height: 1.5;
  }
  .tool-text-output :global(p) { margin: 0.2em 0; }
  .tool-text-output :global(p:first-child) { margin-top: 0; }
  .tool-text-output :global(p:last-child) { margin-bottom: 0; }
  .tool-text-output :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
    background: rgba(0,0,0,0.25);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  .tool-text-output :global(pre) {
    background: var(--bg);
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-x: auto;
    font-size: 0.78rem;
    direction: ltr;
    text-align: left;
  }
  .tool-text-output :global(pre code) { background: none; padding: 0; }
  .tool-text-output :global(ul), .tool-text-output :global(ol) { padding-inline-start: 1.2em; margin: 0.2em 0; }
  .tool-text-output :global(strong) { font-weight: 700; }
  .tool-text-output :global(em) { font-style: italic; }
  /* chat-render-polish: GFM tables בפלט כלי */
  .tool-text-output :global(table) {
    border-collapse: collapse; margin: 0.4em 0; font-size: 0.78rem;
    display: block; overflow-x: auto; max-width: 100%;
  }
  .tool-text-output :global(th), .tool-text-output :global(td) {
    border: 1px solid var(--border); padding: 0.3em 0.55em; text-align: start;
  }
  .tool-text-output :global(th) { background: rgba(0,0,0,0.18); font-weight: 700; }

  .raw-output summary { list-style: none; }
  .raw-output[open] summary { margin-bottom: 4px; }

  /* chat-render-polish: תמונת כלי */
  .tool-image {
    max-width: 100%; max-height: 320px; height: auto;
    object-fit: contain; border-radius: 6px;
    border: 1px solid var(--border); display: block; margin: 0.2em 0;
  }

  /* content-viewer: wrapper לטקסט כלי עם כפתור expand */
  .tool-text-wrapper {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
  }
  .tool-text-wrapper .tool-text-output {
    flex: 1;
    min-width: 0;
  }
  .tool-expand-btn {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--fg-dim);
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.15s;
    padding: 0;
    margin-top: 2px;
  }
  .tool-expand-btn:hover { opacity: 1; }

  /* content-viewer: עטיפת תמונה ב-button לlightbox */
  .tool-image-btn {
    display: block;
    background: none;
    border: none;
    padding: 0;
    cursor: zoom-in;
    border-radius: 6px;
    margin: 0.2em 0;
  }
  .tool-image-btn .tool-image {
    margin: 0;
    transition: opacity 0.15s;
  }
  .tool-image-btn:hover .tool-image { opacity: 0.85; }

  .hidden { display: none; }
</style>
