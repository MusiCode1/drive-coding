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
 * - Markdown: MarkdownContent → renderMarkdown (DOMPurify two-pass + KaTeX) — אסור DOMPurify ידני חדש.
 * - תמונה: רק דרך <img src> — אסור {@html}/<object> (SVG ב-<img> = secure-static-mode).
 *
 * ─── slice/markdown-content-unify (Commit 3) — CSS עבר ל-MarkdownContent, variant="viewer" ───
 */
import XIcon from "@lucide/svelte/icons/x"
import { Dialog as BitsDialog } from "bits-ui"
import MarkdownContent from "$lib/components/chat/bubbles/MarkdownContent.svelte"
import { getContentViewer, getI18n } from "$lib/context"
import FileContentViewer from "./FileContentViewer.svelte"

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
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <BitsDialog.Content
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      onclick={(e) => { if (e.target === e.currentTarget) viewer.close() }}
    >
      <div
        class="w-full max-w-3xl mx-auto flex flex-col overflow-hidden rounded-2xl"
        style="background:var(--bg-elev); border:1px solid var(--border); max-height:100dvh"
      >
        <!-- header -->
        <div class="flex items-center justify-between px-4 py-3 border-b shrink-0" style="border-color:var(--border)">
          <BitsDialog.Title class="text-lg font-semibold">
            {(viewer.payload?.kind === "markdown" || viewer.payload?.kind === "file") &&
            viewer.payload.title
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
              MarkdownContent variant="viewer" — כותרות גדולות יותר ל-fullscreen (h1=1.4em).
              renderMarkdown + DOMPurify two-pass + dir="auto" — מנוהל פנימית ב-MarkdownContent.
            -->
            <MarkdownContent text={viewer.payload.text} variant="viewer" />
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
          {:else if viewer.payload?.kind === "file"}
            <!-- slice fs-file-proxy — קובץ-רכיב רגיל, ייבוא סטטי רגיל (ר' §4 Commit 1) -->
            <FileContentViewer
              uri={viewer.payload.uri}
              title={viewer.payload.title}
            />
          {/if}
        </div>
      </div>
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>

<style>
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
