<script lang="ts">
/**
 * MarkdownContent — קומפוננטת-מרקדאון משותפת לכל משטחי הבועות.
 *
 * prop text: string — טקסט גולמי (לא HTML). מועבר ל-renderMarkdown.
 * prop variant: "bubble" | "viewer" — bubble=ברירת-מחדל; viewer=כותרות גדולות יותר ל-fullscreen.
 *
 * אבטחה: קורא אך ורק ל-renderMarkdown (DOMPurify two-pass + KaTeX).
 *        ה-prop הוא text: string בלבד — אסור לקבל HTML גולמי.
 *
 * CSS: מאוחד מ-MessageBubble+UserBubble; עם שני תיקונים:
 *   req #1 — pre: white-space:pre (לא pre-wrap) + overflow-x:auto (גלילה אופקית)
 *   req #5 — ul/ol: list-style:disc/decimal outside (Tailwind preflight איפס)
 *
 * המנגנון: ה-:global של Svelte הוא unlayered → מנצח את preflight ב-@layer base.
 *
 * ─── slice/markdown-content-unify (Commit 0) ───
 * ─── slice/code-copy-button (Commit 1) — הוספת use:enhanceCodeBlocks ───
 * ─── slice fs-file-proxy (המשך) — prop fileLinks (opt-in) → use:enhanceFileLinks ───
 * ─── slice msg-media — prop imageCwd → renderMarkdown({ cwd }) ───
 */
import { renderMarkdown } from "$lib/util/markdown"
import { getI18n } from "$lib/context"
import { enhanceCodeBlocks } from "./enhance-code-blocks"
import { enhanceFileLinks, type FileLinkParams } from "./enhance-file-links"

let {
  text,
  variant = "bubble",
  imageCwd = null,
  fileLinks,
}: {
  text: string
  variant?: "bubble" | "viewer"
  /** Resolves relative paths in markdown images only. Does not affect fileLinks. */
  imageCwd?: string | null
  fileLinks?: Omit<FileLinkParams, "text" | "label" | "enabled">
} = $props()

const t = getI18n().t
</script>

<div
  class="md-content"
  class:viewer={variant === "viewer"}
  dir="auto"
  use:enhanceCodeBlocks={{ text, labelCopy: t("bubble.copy"), labelCopied: t("bubble.copied") }}
  use:enhanceFileLinks={{
    text,
    cwd: fileLinks?.cwd ?? null,
    onOpen: fileLinks?.onOpen ?? (() => {}),
    label: t("chat.content.attachedFile"),
  }}
>{@html renderMarkdown(text, { cwd: imageCwd })}</div>

<style>
  .md-content :global(p) { margin: 0.25em 0; }
  .md-content :global(p:first-child) { margin-top: 0; }
  .md-content :global(p:last-child) { margin-bottom: 0; }
  .md-content :global(strong) { font-weight: 700; }
  .md-content :global(em) { font-style: italic; }
  .md-content :global(code) {
    font-family: ui-monospace, monospace; font-size: 0.88em;
    background: rgba(0,0,0,0.25); padding: 0.1em 0.3em; border-radius: 3px;
    overflow-wrap: anywhere;   /* inline code עדיין נשבר — רק block code גולש */
  }
  /* ── req #1: code BLOCK — no-wrap + גלילה אופקית (היה white-space:pre-wrap) ── */
  .md-content :global(pre) {
    background: rgba(0,0,0,0.35); padding: 0.6rem 0.8rem; border-radius: 6px;
    margin: 0.4em 0;
    white-space: pre;          /* היה pre-wrap → לא שובר שורות */
    overflow-x: auto;          /* גלילה אופקית */
  }
  .md-content :global(pre code) {
    background: none; padding: 0; font-size: 0.85em;
    overflow-wrap: normal;     /* מבטל את ה-anywhere של inline-code בתוך pre */
    white-space: pre;          /* יורש, מפורש להבהרה */
  }
  /* ── req #5 + rtl-bubble-fixes: סמן inside — זורם בתוך ה-content-box, לא נחתך ע"י overflow-hidden ── */
  .md-content :global(ul) { padding-inline-start: 1.2em; margin: 0.3em 0; list-style: disc inside; }
  .md-content :global(ol) { padding-inline-start: 1.2em; margin: 0.3em 0; list-style: decimal inside; }
  .md-content :global(li) { margin: 0.15em 0; }
  .md-content :global(h1) { font-size: 1.2em; font-weight: 700; margin: 0.4em 0 0.15em; }
  .md-content :global(h2) { font-size: 1.1em; font-weight: 700; margin: 0.4em 0 0.15em; }
  .md-content :global(h3) { font-size: 1em; font-weight: 700; margin: 0.4em 0 0.15em; }
  /* h4-h6 בלי font-size מפורש → יורשים 1em מההורה */
  .md-content :global(h4), .md-content :global(h5), .md-content :global(h6) { font-weight: 700; margin: 0.35em 0 0.15em; }
  /* variant="viewer" — כותרות גדולות יותר ל-fullscreen */
  .md-content.viewer :global(h1) { font-size: 1.4em; margin: 0.5em 0 0.2em; }
  .md-content.viewer :global(h2) { font-size: 1.2em; margin: 0.45em 0 0.2em; }
  .md-content.viewer :global(h3) { font-size: 1.1em; }
  .md-content :global(blockquote) {
    border-inline-start: 3px solid var(--fg-muted);
    background: rgba(127,127,127,0.12);
    padding: 0.25em 0.7rem; border-radius: 0 4px 4px 0;
    margin: 0.4em 0; opacity: 0.9;
  }
  .md-content :global(a) { color: var(--accent); text-decoration: underline; }
  /* ── slice msg-media: markdown images ── */
  .md-content :global(img) {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0.4em 0;
    border-radius: 6px;
  }
  /* ── slice fs-file-proxy: נתיב-קובץ לחיץ בתוך הטקסט ── */
  .md-content :global(.file-link) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    direction: ltr;
    unicode-bidi: isolate;
  }

  .md-content :global(hr) { border: none; border-top: 1px solid var(--border); margin: 0.5em 0; }
  /* code blocks כיוון LTR — מניעת ערבוב RTL בקוד */
  .md-content :global(pre), .md-content :global(code) { direction: ltr; text-align: left; }
  /* GFM tables */
  .md-content :global(table) {
    border-collapse: collapse; margin: 0.4em 0; font-size: 0.92em;
    display: block; overflow-x: auto; max-width: 100%;
  }
  .md-content :global(th), .md-content :global(td) {
    border: 1px solid var(--border); padding: 0.3em 0.55em; text-align: start;
  }
  .md-content :global(th) { background: rgba(0,0,0,0.18); font-weight: 700; }

  /* ── slice/code-copy-button: כפתור-העתקה פר בלוק-קוד ── */
  .md-content :global(pre) { position: relative; }

  .md-content :global(.code-copy-btn) {
    position: absolute;
    top: 0.3rem;
    inset-inline-end: 0.3rem;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--fg-dim);
    cursor: pointer;
    padding: 0;
    /* desktop: מוסתר עד hover על ה-pre */
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  /* desktop: hover על ה-pre מציג את הכפתור */
  @media (hover: hover) {
    .md-content :global(pre:hover .code-copy-btn) {
      opacity: 0.7;
    }
    .md-content :global(.code-copy-btn:hover) {
      opacity: 1;
      color: var(--fg);
    }
  }

  /* mobile: כפתור תמיד גלוי קצת */
  @media (hover: none) {
    .md-content :global(.code-copy-btn) {
      opacity: 0.7;
    }
  }

  /* מצב "הועתק" */
  .md-content :global(.code-copy-btn[data-copied]) {
    color: var(--accent);
    opacity: 1;
  }

  /* ── syntax highlight tokens (slice-code-syntax-highlight, Commit 2) ──────
   * hljs פולט <span class="hljs-*"> — מיופה כאן דרך CSS vars פר-פלטה (app.css).
   * אסור style= על ה-spans — אבטחה. CSS vars מאפשרים שינוי-ערכה בלי JS.
   * ── */
  .md-content :global(.hljs-keyword),
  .md-content :global(.hljs-built_in)         { color: var(--hl-keyword); }
  .md-content :global(.hljs-string),
  .md-content :global(.hljs-template-string),
  .md-content :global(.hljs-template-tag),
  .md-content :global(.hljs-regexp)            { color: var(--hl-string); }
  .md-content :global(.hljs-comment),
  .md-content :global(.hljs-quote)             { color: var(--hl-comment); font-style: italic; }
  .md-content :global(.hljs-number),
  .md-content :global(.hljs-literal)           { color: var(--hl-number); }
  .md-content :global(.hljs-title),
  .md-content :global(.hljs-title\.class_),
  .md-content :global(.hljs-title\.function_) { color: var(--hl-func); }
  .md-content :global(.hljs-type)             { color: var(--hl-type); }
  .md-content :global(.hljs-attr),
  .md-content :global(.hljs-attribute),
  .md-content :global(.hljs-property)          { color: var(--hl-attr); }
  .md-content :global(.hljs-name),
  .md-content :global(.hljs-tag),
  .md-content :global(.hljs-selector-tag)      { color: var(--hl-tag); }
  .md-content :global(.hljs-meta),
  .md-content :global(.hljs-meta\.string),
  .md-content :global(.hljs-operator),
  .md-content :global(.hljs-punctuation)       { color: var(--hl-meta); }
  .md-content :global(.hljs-variable),
  .md-content :global(.hljs-params),
  .md-content :global(.hljs-symbol)            { color: var(--hl-attr); }
  /* selector-class / selector-id (CSS) */
  .md-content :global(.hljs-selector-class),
  .md-content :global(.hljs-selector-id)       { color: var(--hl-func); }
  /* addition / deletion (diff) */
  .md-content :global(.hljs-addition)          { color: var(--hl-string); }
  .md-content :global(.hljs-deletion)          { color: var(--hl-keyword); }
</style>
