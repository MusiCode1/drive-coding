/**
 * mermaid-sanitize.ts — pass-מבודד ל-SVG שmermaid.render מפיק (slice/msg-diagrams).
 *
 * הקשר: `markdown.ts` (renderMarkdown) לא נוגע כאן בכלל — mermaid.render() הוא
 * אסינכרוני, ו-marked.Renderer.code() חייב להחזיר string באופן סינכרוני. לכן
 * הרינדור עובר ל-`use:` action (enhance-mermaid.ts) שרץ *אחרי* ה-{@html},
 * ו-sanitizeMermaidSvg הוא ה-pass המבודד שלו — לא הרחבה של MARKDOWN_ALLOW.
 * ר' brief-msg-diagrams.md §3-א.
 *
 * ── MERMAID_ALLOW נגזר ממדידה, לא מהמצאה ──────────────────────────────────
 * הרשימה למטה היא האיחוד (union) של tags/attrs שנמצאו ב-11 סוגי-תרשימים אמיתיים
 * (flowchart/hebrew/sequence/classDiagram/state/er/pie/gantt/mindmap/gitgraph/journey,
 * mermaid@11.17.2, htmlLabels:false), נגזר ע"י פרסינג ל-DOM (לא regex — regex תופס
 * גם טקסט בתוך <style> כאילו היה tag). ר' brief §11-ב.
 *
 * 🔴 הכרעת-אבטחה (brief §3-ב): `foreignObject`/`switch`/`div` הוסרו במפורש מהאיחוד
 * הנמדד. htmlLabels:false הוא אילוץ-אבטחה (לא העדפה) — הוא מה שמוציא HTML מהמשוואה
 * ומאפשר allowlist שהוא SVG-בלבד. המחיר: `journey` מאבד את שני ה-foreignObject
 * שלו (תוויות section/task) — ר' mermaid-sanitize.test.ts "journey — חריגה מדויקת".
 * אזהרה למי שיגזור מחדש מהפיקסצ'רים: גזירה נאיבית תחזיר foreignObject/switch/div
 * פנימה ותסתום את החור בשקט. החיסור הוא שלב מפורש, לא סינון-אגב.
 */
import DOMPurify from "dompurify"

// ─── tags — union מהמדידה, פחות foreignObject/switch/div (ר' §3-ב) ─────────
export const MERMAID_TAGS = [
  "circle",
  "defs",
  "feDropShadow",
  "filter",
  "g",
  "line",
  "linearGradient",
  "marker",
  "path",
  "polygon",
  "rect",
  "stop",
  "style",
  "svg",
  "symbol",
  "text",
  "title",
  "tspan",
]

// ─── attrs — union מהמדידה (כולל data-* — ALLOW_DATA_ATTR:false לא חוסם ─────
// ─── מפתחות שמופיעים במפורש ב-ALLOWED_ATTR; נמדד) ──────────────────────────
export const MERMAID_ATTR = [
  "alignment-baseline",
  "aria-roledescription",
  "class",
  "clip-rule",
  "cx",
  "cy",
  "d",
  "data-edge",
  "data-et",
  "data-from",
  "data-id",
  "data-look",
  "data-points",
  "data-to",
  "data-type",
  "dominant-baseline",
  "dx",
  "dy",
  "fill",
  "fill-rule",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "gradientunits",
  "height",
  "id",
  "marker-end",
  "marker-start",
  "markerheight",
  "markerunits",
  "markerwidth",
  "name",
  "offset",
  "opacity",
  "orient",
  "overflow",
  "points",
  "preserveaspectratio",
  "r",
  "refx",
  "refy",
  "role",
  "rx",
  "ry",
  "stddeviation",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-width",
  "style",
  "text-anchor",
  "transform",
  "transform-origin",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xml:space",
  "xmlns",
  "y",
  "y1",
  "y2",
]

/**
 * שכבה ב' (§3-ד): מסירה כל `url(...)` שאינו הפניה מקומית לפי-fragment (`#id`).
 *
 * mermaid's own CSS משתמש הרבה ב-`url(#d-<name>-gradient)` (gradient/filter fills
 * באותו מסמך) — הפניה כזו **לעולם לא** יוצרת בקשת-רשת, ולכן חייבת לשרוד (אחרת
 * הצביעה של flowchart/sequence/וכו' נשברת — נמדד: 5-17 מופעים פר-תרשים תקין).
 * כל `url(...)` **אחר** (http/https/protocol-relative/relative-path — הערוץ
 * שנמדד ב-§3-ד/§11-ח) מוסר. נבדק כ-string-replace, לא regex-על-כל-ה-svg —
 * DOMPurify לא נוגע בתוכן `<style>` בכלל.
 */
function stripNonFragmentUrls(css: string): string {
  return css.replace(/url\(([^)]*)\)/gi, (match, arg: string) => {
    const trimmed = arg.trim().replace(/^['"]|['"]$/g, "")
    return trimmed.startsWith("#") ? match : ""
  })
}

/**
 * sanitizeMermaidSvg — pass מבודד ל-SVG שmermaid מפיק, שתי שכבות:
 *
 * 1. DOMPurify.sanitize עם MERMAID_ALLOW — allowlist SVG-בלבד (בלי hooks חדשים;
 *    ה-hook הגלובלי של markdown.ts רץ ממילא על כל קריאת sanitize באפליקציה,
 *    אבל הוא נוגע רק ב-A/BIDI_BLOCK_TAGS — אף אחד מהם לא ב-MERMAID_ALLOW).
 * 2. הסרת `url(...)` שאינם fragment-refs מה-<style> המוטמע — brief §3-ד, שכבה ב'.
 *    DOMPurify לא מסנן CSS בתוך טקסט <style> (נמדד: `url(http://evil/x)` שורד
 *    ללא זה), וזה בדיוק הערוץ ש-mermaid `themeCSS` init-directive יכול לפתוח
 *    (טקסט בשליטת-המודל). שכבה א' (secure ב-initialize, enhance-mermaid.ts)
 *    חוסמת את בקשת-הרשת בזמן ה-render עצמו; זו שכבת-הגנה נוספת על תוכן ה-SVG
 *    שכבר יצא.
 */
export function sanitizeMermaidSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    ALLOWED_TAGS: MERMAID_TAGS,
    ALLOWED_ATTR: MERMAID_ATTR,
    ALLOW_DATA_ATTR: false,
  })
  return clean.replace(
    /<style([^>]*)>([\s\S]*?)<\/style>/gi,
    (_match, attrs: string, css: string) => {
      return `<style${attrs}>${stripNonFragmentUrls(css)}</style>`
    },
  )
}
