/**
 * enhance-remote-images.ts — Svelte use:-action that turns canonical remote
 * markdown image text into click-to-load buttons.
 *
 * Co-located in bubbles/ (presentation-DOM only). Builds DOM via createElement
 * — no innerHTML — so it does not expand DOMPurify's HTML surface.
 */
import type { Action } from "svelte/action"

const REMOTE_IMAGE_RE = /!\[([^\]\n]*)\]\((https?:\/\/[^\s)<>"']+)\)/g

export type RemoteImageParams = {
  /** Derived from text changes — re-runs enhance after {@html} replacement */
  text: string
  /** Button label (i18n, passed from MarkdownContent) */
  label: string
  /**
   * 🔴 Security control OFF-switch (settings.autoLoadRemoteImages, default false).
   * true → the image is inserted immediately instead of a click-to-load button,
   * i.e. the browser fetches whatever URL the agent emitted, by itself.
   * The user asked for this knob explicitly; the safe value is the default.
   * Does NOT touch IMG_ALLOW / pass-3c — only the *target* of this action.
   */
  autoLoad?: boolean
}

/** Single place that builds the <img> — used by both autoLoad and the click path. */
function makeImg(url: string, alt: string): HTMLImageElement {
  const img = document.createElement("img")
  img.src = url
  img.alt = alt
  img.referrerPolicy = "no-referrer"
  return img
}

function isSkipped(node: Node): boolean {
  let el = node.parentElement
  while (el !== null) {
    if (
      el.tagName === "PRE" ||
      el.tagName === "CODE" ||
      el.tagName === "A" ||
      el.dataset["remoteSrc"] !== undefined
    ) {
      return true
    }
    el = el.parentElement
  }
  return false
}

function enhance(node: HTMLElement, p: RemoteImageParams): void {
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
    REMOTE_IMAGE_RE.lastIndex = 0
    const matches = [...text.matchAll(REMOTE_IMAGE_RE)]
    if (matches.length === 0) continue

    const frag = document.createDocumentFragment()
    let cursor = 0
    for (const m of matches) {
      const start = m.index ?? 0
      if (start > cursor) frag.append(text.slice(cursor, start))

      const alt = m[1] ?? ""
      const url = m[2] ?? ""

      if (p.autoLoad === true) {
        frag.append(makeImg(url, alt))
        cursor = start + m[0].length
        continue
      }

      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "remote-image-load"
      btn.dataset["remoteSrc"] = url
      btn.dataset["remoteAlt"] = alt
      btn.textContent = p.label
      frag.append(btn)

      cursor = start + m[0].length
    }
    if (cursor < text.length) frag.append(text.slice(cursor))
    textNode.replaceWith(frag)
  }
}

export const enhanceRemoteImages: Action<HTMLElement, RemoteImageParams> = (node, params) => {
  let currentParams = params

  function onClick(ev: MouseEvent) {
    const target = ev.target
    if (!(target instanceof Element)) return
    const btn = target.closest<HTMLElement>("[data-remote-src]")
    if (btn === null) return
    const src = btn.dataset["remoteSrc"]
    if (src === undefined) return
    ev.preventDefault()

    btn.replaceWith(makeImg(src, btn.dataset["remoteAlt"] ?? ""))
  }

  node.addEventListener("click", onClick)
  enhance(node, currentParams)

  return {
    update(next: RemoteImageParams) {
      currentParams = next
      enhance(node, next)
    },
    destroy() {
      node.removeEventListener("click", onClick)
    },
  }
}
