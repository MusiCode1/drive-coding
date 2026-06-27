<script lang="ts">
/**
 * ContentViewerDialog — דיאלוג fullscreen לתצוגת Markdown ותמונות.
 *
 * Leaf component: קורא getContentViewer() ו-getI18n().t בלבד.
 * אין fetch, אין actions — רק שרות UI state מה-VM.
 *
 * ─── מבנה: מעתיק שלד bits-ui מ-FolderPickerDialog, מותאם fullscreen ───
 * ─── slice content-viewer ───
 *
 * Security:
 * - Markdown: רינדור דרך renderMarkdown (DOMPurify two-pass + KaTeX) — אסור DOMPurify ידני חדש.
 * - תמונה: רק דרך <img src> — אסור {@html}/<object> (SVG ב-<img> = secure-static-mode).
 */
import { Dialog as BitsDialog } from "bits-ui"
import XIcon from "@lucide/svelte/icons/x"
import { getContentViewer, getI18n } from "$lib/context"
import { renderMarkdown } from "$lib/util/markdown"

const t = getI18n().t
const viewer = getContentViewer()

function onOpenChange(open: boolean) {
  if (!open) viewer.close()
}
</script>

<BitsDialog.Root open={viewer.open} {onOpenChange}>
  <BitsDialog.Portal>
    <BitsDialog.Overlay
      class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
    />
    <BitsDialog.Content
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        class="w-full max-w-3xl mx-auto flex flex-col overflow-hidden rounded-2xl"
        style="background:var(--bg-elev); border:1px solid var(--border); max-height:100dvh"
      >
        <!-- header -->
        <div class="flex items-center justify-between px-4 py-3 border-b shrink-0" style="border-color:var(--border)">
          <BitsDialog.Title class="text-lg font-semibold">
            {viewer.payload?.kind === "markdown" && viewer.payload.title
              ? viewer.payload.title
              : t("contentViewer.title")}
          </BitsDialog.Title>
          <BitsDialog.Close
            class="size-8 grid place-items-center rounded-lg"
            style="color:var(--fg-dim)"
            aria-label={t("contentViewer.close")}
          >
            <XIcon size={16} strokeWidth={2} />
          </BitsDialog.Close>
        </div>

        <!-- body -->
        <div class="flex-1 overflow-y-auto chat-scroll px-4 py-3">
          {#if viewer.payload?.kind === "markdown"}
            <!--
              אותו מסלול מסונן כמו MessageBubble — renderMarkdown מסנן DOMPurify two-pass.
              dir="auto" — זיהוי כיוון אוטומטי לפי תוכן (עברית/אנגלית).
            -->
            <div class="markdown-body" dir="auto">{@html renderMarkdown(viewer.payload.text)}</div>
          {:else if viewer.payload?.kind === "image"}
            <!--
              Invariant אבטחה (זהה ל-ToolBubble:120): תמונה מוצגת **רק** דרך <img>.
              אסור {@html}/<object> — SVG ב-<img> רץ ב-secure-static-mode.
            -->
            <img
              class="viewer-image"
              src={viewer.payload.src}
              alt={viewer.payload.alt ?? t("contentViewer.title")}
            />
          {/if}
        </div>
      </div>
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>

<style>
  /* Markdown styling — מעתיק מ-MessageBubble עם התאמות ל-fullscreen */
  .markdown-body :global(p) { margin: 0.35em 0; }
  .markdown-body :global(p:first-child) { margin-top: 0; }
  .markdown-body :global(p:last-child) { margin-bottom: 0; }
  .markdown-body :global(strong) { font-weight: 700; }
  .markdown-body :global(em) { font-style: italic; }
  .markdown-body :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
    background: rgba(0,0,0,0.25);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    overflow-wrap: anywhere;
  }
  .markdown-body :global(pre) {
    background: rgba(0,0,0,0.35);
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    margin: 0.4em 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-x: auto;
    direction: ltr;
    text-align: left;
  }
  .markdown-body :global(pre code) { background: none; padding: 0; font-size: 0.85em; }
  .markdown-body :global(ul), .markdown-body :global(ol) { padding-inline-start: 1.4em; margin: 0.3em 0; }
  .markdown-body :global(li) { margin: 0.15em 0; }
  .markdown-body :global(h1) { font-size: 1.4em; font-weight: 700; margin: 0.5em 0 0.2em; }
  .markdown-body :global(h2) { font-size: 1.2em; font-weight: 700; margin: 0.45em 0 0.2em; }
  .markdown-body :global(h3) { font-size: 1.1em; font-weight: 700; margin: 0.4em 0 0.15em; }
  .markdown-body :global(h4), .markdown-body :global(h5), .markdown-body :global(h6) {
    font-size: 1em; font-weight: 700; margin: 0.35em 0 0.15em;
  }
  .markdown-body :global(blockquote) {
    border-inline-start: 3px solid var(--border);
    padding-inline-start: 0.7rem;
    margin: 0.3em 0;
    opacity: 0.8;
  }
  .markdown-body :global(a) { color: var(--accent); text-decoration: underline; }
  .markdown-body :global(hr) { border: none; border-top: 1px solid var(--border); margin: 0.5em 0; }
  /* GFM tables */
  .markdown-body :global(table) {
    border-collapse: collapse; margin: 0.4em 0; font-size: 0.92em;
    display: block; overflow-x: auto; max-width: 100%;
  }
  .markdown-body :global(th), .markdown-body :global(td) {
    border: 1px solid var(--border); padding: 0.3em 0.55em; text-align: start;
  }
  .markdown-body :global(th) { background: rgba(0,0,0,0.18); font-weight: 700; }

  /* תמונה fullscreen — ממורכזת, גולשת ב-y */
  .viewer-image {
    max-width: 100%;
    height: auto;
    object-fit: contain;
    display: block;
    margin: 0 auto;
    border-radius: 6px;
  }
</style>
