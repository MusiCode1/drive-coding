/**
 * enhance-file-links.ts — Svelte use:-action שהופך נתיבי-קבצים בטקסט מרונדר
 * לכפתורים לחיצים שפותחים את ה-ContentViewer.
 *
 * co-located ב-bubbles/ (presentation-DOM בלבד) — אותה תבנית כמו
 * `enhance-code-blocks.ts`, כולל event-delegation ששורד החלפת {@html}.
 *
 * 🔴 פועל **אחרי** ה-sanitize, ורק על טקסט. הוא אינו מזריק HTML מהמודל:
 * הוא מפצל צומתי-טקסט ובונה <button> בעצמו (createElement + textContent),
 * ולכן אינו מרחיב את משטח-ה-HTML של DOMPurify.
 *
 * ─── slice fs-file-proxy (המשך — הדק לחיץ להודעת-המשתמש) ───
 */
import type { Action } from "svelte/action"
import { findFilePathMatches, resolveFileUri } from "$lib/util/file-path-links"

export type FileLinkParams = {
  /** נגזר משינוי הטקסט — מפעיל enhance מחדש אחרי החלפת {@html} */
  text: string
  /** ה-cwd של הסשן, לפתרון נתיבים יחסיים. null → יחסיים לא מלונקקים */
  cwd: string | null
  /** נקרא בלחיצה, עם ה-URI הפתור */
  onOpen: (uri: string) => void
  /** aria-label/title לכפתור */
  label: string
}

/** צמתים שבתוכם לא מלנקקים: בלוק-קוד וקישור קיים. inline <code> כן — שם נתיבים באמת נכתבים. */
function isSkipped(node: Node): boolean {
  let el = node.parentElement
  while (el !== null) {
    if (el.tagName === "PRE" || el.tagName === "A" || el.dataset["fileLink"] !== undefined) {
      return true
    }
    el = el.parentElement
  }
  return false
}

function enhance(node: HTMLElement, p: FileLinkParams): void {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let cur: Node | null = walker.nextNode()
  while (cur !== null) {
    if (cur.textContent !== null && cur.textContent.length > 0 && !isSkipped(cur)) {
      targets.push(cur as Text)
    }
    cur = walker.nextNode()
  }

  for (const textNode of targets) {
    const text = textNode.textContent ?? ""
    const matches = findFilePathMatches(text).filter((m) => resolveFileUri(m.raw, p.cwd) !== null)
    if (matches.length === 0) continue

    const frag = document.createDocumentFragment()
    let cursor = 0
    for (const m of matches) {
      if (m.start > cursor) frag.append(text.slice(cursor, m.start))
      const uri = resolveFileUri(m.raw, p.cwd)
      if (uri === null) {
        frag.append(m.raw)
      } else {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "file-link"
        btn.dataset["fileLink"] = uri
        btn.title = p.label
        btn.setAttribute("aria-label", p.label)
        btn.textContent = m.raw
        frag.append(btn)
      }
      cursor = m.end
    }
    if (cursor < text.length) frag.append(text.slice(cursor))
    textNode.replaceWith(frag)
  }
}

export const enhanceFileLinks: Action<HTMLElement, FileLinkParams> = (node, params) => {
  let currentParams = params

  function onClick(ev: MouseEvent) {
    const target = ev.target
    if (!(target instanceof Element)) return
    const btn = target.closest<HTMLElement>("[data-file-link]")
    if (btn === null) return
    const uri = btn.dataset["fileLink"]
    if (uri === undefined) return
    ev.preventDefault()
    currentParams.onOpen(uri)
  }

  node.addEventListener("click", onClick)
  enhance(node, currentParams)

  return {
    update(next: FileLinkParams) {
      currentParams = next
      enhance(node, next)
    },
    destroy() {
      node.removeEventListener("click", onClick)
    },
  }
}
