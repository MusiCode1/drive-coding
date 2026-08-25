/**
 * enhance-mermaid.ts — Svelte use:-action שהופך בלוק ```` ```mermaid ```` ל-SVG מצויר.
 *
 * co-located ב-bubbles/ (presentation-DOM), אותה תבנית כמו enhance-remote-images.ts /
 * enhance-code-blocks.ts: פועל *אחרי* ה-{@html} (renderMarkdown ממשיך להחזיר
 * <pre><code class="hljs language-mermaid"> כבלוק-קוד רגיל — brief §3-א).
 *
 * ─── slice/msg-diagrams (Commit 1) ───
 *
 * 🔴 פרמטר `render` הוא חלק מה-DoD, לא פרט-מימוש: mermaid לא מרנדר ב-jsdom
 * (getBBox חסר), אז זה הדבר היחיד שהופך את ה-action לבר-בדיקה ביחידות (brief §11-ג).
 * ברירת-המחדל = import("mermaid") דינמי — DoD 4 (עצלות) נשען על זה: מסמך בלי
 * בלוק-mermaid לא מייבא את mermaid בכלל.
 *
 * זרימה (brief §4 Commit 1 §4-6):
 *   1. cache-hit → applyResult סינכרוני (אין await נוסף).
 *   2. cache-miss → `pre.dataset.mermaidState = "pending"` (סינכרוני, לפני ה-await).
 *   3. render מצליח → sanitizeMermaidSvg → ה-<pre> **מוחלף** ב-<div class="mermaid-diagram">.
 *   4. render נכשל → ה-<pre> **נשאר כפי שהוא** (התנהגות-היום), רק data-mermaid-state="error"
 *      נוסף עליו. אין throw החוצה.
 *   בשני המקרים: אם ה-<pre> כבר התנתק מה-DOM (streaming-race — {@html} החליף הכל
 *   מתחת לרגליים, brief §4 סעיף 4 + אביגיל ממצא 9) — לא נוגעים בו.
 */
import type { Action } from "svelte/action"
import { sanitizeMermaidSvg } from "$lib/util/mermaid-sanitize"

export type MermaidParams = {
  /** מפעיל update() בכל שינוי — streaming מצייר-מחדש רק מה שהשתנה (מטמון). */
  text: string
  /** לחיצה על תרשים מוכן → ContentViewer (Commit 2). */
  onExpand?: (svg: string) => void
  /**
   * aria-label לתרשים הלחיץ — i18n קיים (`contentViewer.expand`), לא מפתח חדש
   * (brief §4 Commit 2 סעיף 4). לא חובה: אם onExpand מוגדר בלי label, הכפתור
   * עדיין לחיץ, רק בלי aria-label.
   */
  expandLabel?: string
  /** הזרקה לטסטים בלבד. ברירת-מחדל = מרנדר האמיתי (import דינמי). */
  render?: (code: string, id: string) => Promise<string>
}

type CacheEntry = { kind: "ready"; svg: string } | { kind: "error" }

// ─── מטמון + מונה ברמת-מודול — חוצה instances של ה-action (Commit 1 §2-3) ──
const renderCache = new Map<string, CacheEntry>()
let idCounter = 0
let mermaidInitDone = false

// mermaid דורס ולא ממזג את `secure` — ששת ברירות-המחדל שלו (11.17.2) חייבות
// לחזור, בנוסף למה שאנחנו מוסיפים (brief §3-ד).
const MERMAID_DEFAULT_SECURE = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
]

/** קורא CSS vars מהפלטה הפעילה — theme:"base" + themeVariables (brief §3-ג). */
function themeVariablesFromCss(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const v = (name: string) => style.getPropertyValue(name).trim()
  return {
    background: v("--bg"),
    primaryColor: v("--bg-card"),
    primaryTextColor: v("--fg"),
    lineColor: v("--border"),
    textColor: v("--fg"),
  }
}

/**
 * import + initialize (פעם אחת). lazy — נקרא רק כשיש בלוק-mermaid אמיתי,
 * כך שמסמך בלי mermaid לעולם לא מוריד את הספרייה (DoD 4).
 */
async function loadMermaid(): Promise<typeof import("mermaid").default> {
  const { default: mermaid } = await import("mermaid")
  if (!mermaidInitDone) {
    mermaidInitDone = true
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: themeVariablesFromCss(),
      secure: [
        ...MERMAID_DEFAULT_SECURE,
        "themeCSS",
        "theme",
        "themeVariables",
        "fontFamily",
        "altFontFamily",
        "htmlLabels",
        "flowchart",
      ],
    })
  }
  return mermaid
}

const defaultRender: NonNullable<MermaidParams["render"]> = async (code, id) => {
  const mermaid = await loadMermaid()
  const { svg } = await mermaid.render(id, code)
  return svg
}

/** מיישם תוצאה (ready/error) על ה-<pre> המקורי. */
function applyResult(
  pre: HTMLElement,
  entry: CacheEntry,
  onExpand: MermaidParams["onExpand"],
  expandLabel: MermaidParams["expandLabel"],
): void {
  if (entry.kind === "error") {
    // Commit 1 §6: ה-<pre> נשאר כפי שהוא — רק המצב מתעדכן.
    pre.dataset.mermaidState = "error"
    return
  }

  const wrapper = document.createElement("div")
  wrapper.className = "mermaid-diagram"
  wrapper.dataset.mermaidState = "ready"
  wrapper.innerHTML = entry.svg
  if (onExpand !== undefined) {
    // Commit 2: יעד-מגע לחיץ (אפליקציית-נהיגה) — role+tabindex+Enter/Space,
    // לצד click. aria-label ממוחזר מ-contentViewer.expand הקיים (לא מפתח חדש).
    wrapper.onclick = () => onExpand(entry.svg)
    wrapper.setAttribute("role", "button")
    wrapper.tabIndex = 0
    if (expandLabel !== undefined) wrapper.setAttribute("aria-label", expandLabel)
    wrapper.onkeydown = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault()
        onExpand(entry.svg)
      }
    }
  }
  pre.replaceWith(wrapper)
}

/** מריץ render (מוזרק או אמיתי) על בלוק אחד. */
function processBlock(
  pre: HTMLElement,
  code: string,
  renderFn: NonNullable<MermaidParams["render"]>,
  onExpand: MermaidParams["onExpand"],
  expandLabel: MermaidParams["expandLabel"],
): void {
  const cached = renderCache.get(code)
  if (cached !== undefined) {
    applyResult(pre, cached, onExpand, expandLabel)
    return
  }

  // "pending" סינכרונית, לפני ה-await (DoD 6 נתלה בזה).
  pre.dataset.mermaidState = "pending"

  const id = `mermaid-diagram-${++idCounter}`
  renderFn(code, id)
    .then((svg) => {
      const entry: CacheEntry = { kind: "ready", svg: sanitizeMermaidSvg(svg) }
      renderCache.set(code, entry)
      // 🔴 מרוץ-streaming (אביגיל ממצא 9): {@html} עשוי להיות כבר החליף הכל.
      if (!pre.isConnected) return
      applyResult(pre, entry, onExpand, expandLabel)
    })
    .catch(() => {
      const entry: CacheEntry = { kind: "error" }
      renderCache.set(code, entry)
      if (!pre.isConnected) return
      applyResult(pre, entry, onExpand, expandLabel)
    })
}

function enhance(node: HTMLElement, params: MermaidParams): void {
  const renderFn = params.render ?? defaultRender
  const blocks = node.querySelectorAll<HTMLElement>("pre > code.language-mermaid")
  for (const code of blocks) {
    const pre = code.parentElement
    if (pre === null) continue
    const text = code.textContent ?? ""
    processBlock(pre, text, renderFn, params.onExpand, params.expandLabel)
  }
}

export const enhanceMermaid: Action<HTMLElement, MermaidParams> = (node, params) => {
  enhance(node, params)

  return {
    update(next: MermaidParams) {
      enhance(node, next)
    },
  }
}
