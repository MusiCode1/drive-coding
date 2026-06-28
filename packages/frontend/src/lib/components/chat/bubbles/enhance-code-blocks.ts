/**
 * enhance-code-blocks.ts — Svelte use:-action להזרקת כפתור-העתקה לכל <pre>.
 *
 * co-located ב-bubbles/ (presentation-DOM בלבד, לא cross-layer procedure).
 *
 * גוטשת streaming:
 *  כש-{@html} מתעדכן, Svelte מחליף את innerHTML → הכפתורים נמחקים.
 *  הפתרון: event-delegation — מאזין click אחד על ה-node (נרשם ב-setup, שורד re-render).
 *  update(params) נורה אחרי עדכון-ה-DOM → enhance() מזריק-מחדש כפתורים לכל <pre> חדש.
 *
 * ─── slice/code-copy-button (Commit 0) ───
 */
import type { Action } from "svelte/action"
import { copyToClipboard } from "$lib/util/clipboard"

export type CodeCopyParams = {
  text: string
  labelCopy: string
  labelCopied: string
}

/** SVG inline של אייקון "copy" מ-lucide (viewBox 0 0 24 24) */
const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
</svg>`

/** SVG inline של אייקון "check" מ-lucide (viewBox 0 0 24 24) */
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/>
</svg>`

/**
 * מזריק כפתור-העתקה לכל <pre> תחת ה-node.
 *
 * - mount + update(params): מזריק כפתור לכל <pre> שאין לו עדיין (data-copy-ready flag).
 * - event delegation: מאזין click אחד על ה-node (נרשם פעם אחת ב-setup, שורד re-render).
 * - update קורה כש-text משתנה (streaming) → ה-{@html} הוחלף → מזריקים מחדש.
 */
export const enhanceCodeBlocks: Action<HTMLElement, CodeCopyParams> = (node, params) => {
  let currentParams = params

  /** מזריק כפתורים לכל <pre> חדש (שאין לו data-copy-ready) */
  function enhance(p: CodeCopyParams) {
    const pres = node.querySelectorAll<HTMLElement>("pre:not([data-copy-ready])")
    for (const pre of pres) {
      pre.dataset["copyReady"] = "1"
      const btn = document.createElement("button")
      btn.className = "code-copy-btn"
      btn.type = "button"
      btn.setAttribute("aria-label", p.labelCopy)
      btn.innerHTML = COPY_SVG
      pre.appendChild(btn)
    }
  }

  /** מטפל ב-click על הכפתורים (event delegation על ה-node) */
  async function onClick(e: MouseEvent) {
    const target = e.target as Element | null
    const btn = target?.closest<HTMLElement>(".code-copy-btn")
    if (!btn) return

    const pre = btn.closest("pre")
    if (!pre) return

    // מחלץ את הטקסט מה-<code> (מסנן HTML entities ו-spans של highlight)
    const code = pre.querySelector("code")
    const text = (code?.textContent ?? pre.textContent ?? "").trimEnd()

    const ok = await copyToClipboard(text)
    if (!ok) return

    // משוב ✓ — מחליף ל-check ל-2 שניות
    btn.innerHTML = CHECK_SVG
    btn.setAttribute("aria-label", currentParams.labelCopied)
    btn.dataset["copied"] = "1"

    setTimeout(() => {
      btn.innerHTML = COPY_SVG
      btn.setAttribute("aria-label", currentParams.labelCopy)
      delete btn.dataset["copied"]
    }, 2000)
  }

  // setup: רישום delegation listener פעם אחת (שורד re-render של innerHTML)
  node.addEventListener("click", onClick)
  enhance(currentParams)

  return {
    update(newParams: CodeCopyParams) {
      currentParams = newParams
      // update נורה אחרי עדכון-ה-DOM → מזריקים מחדש לכל <pre> חדש
      enhance(newParams)
    },
    destroy() {
      node.removeEventListener("click", onClick)
    },
  }
}
