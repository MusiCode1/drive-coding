/**
 * code-highlight.ts — צביעת syntax עם highlight.js (class-based, בלי style).
 *
 * ── אבטחה ──────────────────────────────────────────────────────────────────
 * הפלט הוא HTML עם <span class="hljs-*"> בלבד — ללא style, ללא attributes אחרים.
 * ה-HTML הזה מסונן ב-CODE_ALLOW (markdown.ts) לפני הכנסתו ל-DOM.
 * אסור להשתמש ב-highlightAuto — שפה לא-מוכרת/חסרה → plain escaped.
 *
 * ── bundle control ──────────────────────────────────────────────────────────
 * מיובא highlight.js/lib/core בלבד + רישום ידני של ~15 שפות.
 * אסור: import hljs from "highlight.js" (גורר הכל, ~900KB).
 *
 * ── רישום ──────────────────────────────────────────────────────────────────
 * registerLanguages() נקרא פעם אחת ברמת מודול (כמו marked.use).
 * highlightCode() בטוח לקריאה חוזרת.
 */

import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import go from "highlight.js/lib/languages/go"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

// ── רישום שפות (פעם אחת ברמת מודול) ────────────────────────────────────────
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("python", python)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("html", xml) // html = xml ב-hljs
hljs.registerLanguage("css", css)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("diff", diff)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("rust", rust)
hljs.registerLanguage("go", go)
hljs.registerLanguage("c", c)
hljs.registerLanguage("java", java)
// aliases נפוצים
hljs.registerLanguage("ts", typescript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("sh", bash)
hljs.registerLanguage("py", python)
hljs.registerLanguage("yml", yaml)
hljs.registerLanguage("rs", rust)

/**
 * מחזיר HTML צבוע (span.hljs-* בלבד, ללא style) לקוד נתון.
 *
 * - lang מוכר ורשום → hljs.highlight(code, { language: lang })
 * - lang חסר/ריק/לא-מוכר → escapeHtml בלבד (plain), ללא spans, ללא throw.
 *
 * אסור throw. ה-ignoreIllegals:true מבטיח שקוד חלקי (streaming) לא זורק.
 */
export function highlightCode(code: string, lang: string | undefined): string {
  const normalizedLang = lang?.trim().toLowerCase() ?? ""

  if (normalizedLang && hljs.getLanguage(normalizedLang)) {
    try {
      const result = hljs.highlight(code, {
        language: normalizedLang,
        ignoreIllegals: true,
      })
      return result.value
    } catch {
      // fallback ל-plain בכל מקרה של שגיאה בלתי-צפויה
      return escapeHtml(code)
    }
  }

  return escapeHtml(code)
}

/** escape HTML — מונע HTML-injection מקוד גולמי. */
export function escapeHtml(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
