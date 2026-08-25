<script lang="ts">
/**
 * FileContentViewer — נטען דרך GET /api/fs/file, מציג לפי Content-Type
 * (markdown מרונדר / תמונה / PDF inline-אם-נתמך / קישור-הורדה fallback).
 *
 * 🔴 קובץ-רכיב רגיל, לא snippet ולא ה-directive המיוחדת (deprecated ב-Svelte 5)
 * לרינדור-דינמי-לפי-משתנה (ר' §4 Commit 1 בבריף — r2 ניסה לשלב אותה עם snippet,
 * שילוב בלתי-אפשרי).
 *
 * ─── slice fs-file-proxy (Commit 1) ───
 */

import MarkdownContent from "$lib/components/chat/bubbles/MarkdownContent.svelte"
import { getI18n } from "$lib/context"
import { beUrl } from "$lib/util/be-url"
import { baseContentType, isRenderableText } from "$lib/util/content-type"
import { canRenderPdfInline } from "$lib/util/pdf-render-support"

const t = getI18n().t

/** Document directory for resolving relative images in opened .md files. */
function imageCwdFromFileUri(uri: string): string {
  const path = uri.replace(/^file:\/\//i, "")
  const slash = path.lastIndexOf("/")
  const dir = slash >= 0 ? path.slice(0, slash) : ""
  return dir === "" ? "/" : dir
}

let { uri, title }: { uri: string; title?: string } = $props()

let contentType = $state("")
// 🔴 ההשוואות למטה הן על **טיפוס-הבסיס** ולא על הכותרת המלאה. ה-BE מצהיר
// `text/markdown; charset=utf-8`, והשוואה מדויקת הייתה מפילה כל מסמך לענף
// ההורדה (ממצא-משתמש חי 25/08).
const baseType = $derived(baseContentType(contentType))
let blobUrl = $state("")
let markdownText = $state("")
let error = $state("")

$effect(() => {
  // Q3 decision (§9 בבריף): הדיאלוג טוען מחדש בכל פתיחה — ה-$effect רץ מחדש
  // כש-uri משתנה. reset מפורש כדי לא להציג תוכן-ישן בזמן שה-fetch החדש בטיסה.
  contentType = ""
  blobUrl = ""
  markdownText = ""
  error = ""

  let cancelled = false
  let localBlobUrl = ""

  fetch(beUrl(`/api/fs/file?uri=${encodeURIComponent(uri)}`))
    .then(async (r) => {
      const ct = r.headers.get("content-type") ?? ""
      if (!r.ok) throw new Error(`${r.status} ${r.url}`)
      if (isRenderableText(ct)) {
        return { ct, kind: "text" as const, text: await r.text() }
      }
      return { ct, kind: "blob" as const, blob: await r.blob() }
    })
    .then((result) => {
      if (cancelled) return
      contentType = result.ct
      if (result.kind === "text") {
        markdownText = result.text
      } else {
        // הבלוב נוצר בזמן-ריצה מ-fetch — לא ניתן ל-SSR ולכן ה-URL.createObjectURL
        // חי רק כאן (component client-only, SPA-only per AGENTS.md).
        localBlobUrl = URL.createObjectURL(result.blob)
        blobUrl = localBlobUrl
      }
    })
    .catch((e) => {
      if (!cancelled) error = String(e)
    })

  // cleanup: מריץ **לפני** run הבא (או ב-unmount). local לפתרון race בין
  // fetch מהיר לבין effect שרץ שוב לפני שהראשון סיים (DoD בדיקה 12).
  return () => {
    cancelled = true
    if (localBlobUrl) URL.revokeObjectURL(localBlobUrl)
  }
})
</script>

{#if error}
  <a href={uri} target="_blank" rel="noreferrer" class="text-link">
    {t("contentViewer.download")} — {error}
  </a>
{:else if baseType.startsWith("image/")}
  <img src={blobUrl} class="viewer-image" alt={title ?? t("contentViewer.title")} />
{:else if baseType === "application/pdf" && canRenderPdfInline()}
  <iframe src={blobUrl} class="pdf-frame" title={title ?? t("contentViewer.title")}></iframe>
{:else if baseType === "application/pdf"}
  <!-- אין תמיכת iframe (למשל iOS Safari) → טאב חדש + קישור-הורדה, לא מסך-לבן -->
  <a href={blobUrl} target="_blank" rel="noreferrer" class="text-link">
    {t("contentViewer.download")}
  </a>
{:else if isRenderableText(contentType)}
  <MarkdownContent text={markdownText} variant="viewer" imageCwd={imageCwdFromFileUri(uri)} />
{:else if blobUrl}
  <a href={blobUrl} download class="text-link">
    {t("contentViewer.download")}
  </a>
{/if}

<style>
  .viewer-image {
    max-width: 100%;
    height: auto;
    object-fit: contain;
    display: block;
    margin: 0 auto;
    border-radius: 6px;
  }

  .pdf-frame {
    width: 100%;
    height: 70dvh;
    border: none;
    border-radius: 6px;
  }

  .text-link {
    color: var(--accent, #4f8cff);
    text-decoration: underline;
  }
</style>
