<script lang="ts">
/**
 * MessageBubble — מרנדר את הודעת הסוכן עם תמיכה מלאה ב-Markdown.
 *
 * Slice 4: עבר מטקסט פשוט ל-Markdown מחוטא (sanitized).
 * DOMPurify מחטא את הפלט של marked — בטוח כנגד התקפות XSS שמוזרקות דרך הסוכן.
 *
 * המאפיין dir="auto" על מיכל התוכן: הדפדפן מחליט האם זה LTR/RTL לכל פסקה
 * בהתבסס על התו הדו-כיווני (bidi) החזק הראשון. מטפל בטקסט עברי בצורה נכונה.
 *
 * הערת הזרמה (Streaming): הפונקציה renderMarkdown מקבלת את כל טקסט הבועה, ולא
 * מקטע אחד בכל פעם. מבני Markdown יכולים להשתרע על פני מספר מקטעי ACP.
 */
import type { MessageBubble } from "$lib/types/bubble"
import { getI18n } from "$lib/context"
import { renderMarkdown } from "$lib/util/markdown"
import { joinSegmentText } from "./bubble-rendering"

let { bubble }: { bubble: MessageBubble } = $props()
const t = getI18n().t
</script>

<div class="bubble bubble-message">
  <div class="kind-label">{t("chat.bubble.agent")}</div>
  <div class="text" dir="auto">
    {@html renderMarkdown(joinSegmentText(bubble.segments))}
    <span class="hidden">{bubble.segments.length}</span>
  </div>
</div>

<style>
  .bubble {
    max-width: 80%;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    line-height: 1.4;
  }

  .bubble-message {
    /* יישור RTL: הערך flex-end = צד שמאל (הסוכן נמצא בצד שמאל) */
    align-self: flex-end;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    /* א-סימטרי: הפינה השטוחה מצביעה לכיוון הסוכן (שמאל-למטה ב-RTL) */
    border-bottom-left-radius: 4px;
  }

  .kind-label {
    font-size: 0.7rem;
    opacity: 0.7;
    margin-bottom: 4px;
    font-weight: 600;
  }

  .text {
    word-wrap: break-word;
  }

  .text > .hidden {
    display: none;
  }

  /* עיצוב רכיבי Markdown — תחומי (scoped) דרך :global בתוך .text */
  .text :global(p) {
    margin: 0.25em 0;
  }

  .text :global(p:first-child) {
    margin-top: 0;
  }

  .text :global(p:last-child) {
    margin-bottom: 0;
  }

  .text :global(strong) {
    font-weight: 700;
  }

  .text :global(em) {
    font-style: italic;
  }

  .text :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
    background: var(--bg-base, rgba(0, 0, 0, 0.25));
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }

  .text :global(pre) {
    background: var(--bg-base, rgba(0, 0, 0, 0.35));
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.4em 0;
  }

  .text :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85em;
  }

  .text :global(ul),
  .text :global(ol) {
    padding-inline-start: 1.4em;
    margin: 0.3em 0;
  }

  .text :global(li) {
    margin: 0.15em 0;
  }

  .text :global(h1),
  .text :global(h2),
  .text :global(h3),
  .text :global(h4) {
    font-weight: 700;
    margin: 0.4em 0 0.15em;
    line-height: 1.25;
  }

  .text :global(h1) { font-size: 1.2em; }
  .text :global(h2) { font-size: 1.1em; }
  .text :global(h3) { font-size: 1em; }
  .text :global(h4) { font-size: 0.95em; }

  .text :global(blockquote) {
    border-inline-start: 3px solid var(--border);
    padding-inline-start: 0.7rem;
    margin: 0.3em 0;
    opacity: 0.8;
  }

  .text :global(a) {
    color: var(--accent, #60a5fa);
    text-decoration: underline;
  }

  .text :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.5em 0;
  }
</style>
