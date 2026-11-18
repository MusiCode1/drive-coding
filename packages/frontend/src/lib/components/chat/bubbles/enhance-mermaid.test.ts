// @vitest-environment jsdom
/**
 * enhance-mermaid.test.ts — TDD ל-enhanceMermaid עם `render` מוזרק (brief §4 Commit 1).
 *
 * mermaid לא מרנדר ב-jsdom (getBBox חסר) — כל הטסטים כאן מזריקים `render` ולא
 * נוגעים ב-mermaid.render האמיתי בכלל.
 */
import type { ActionReturn } from "svelte/action"
import { afterEach, describe, expect, it, vi } from "vitest"
import { enhanceMermaid, type MermaidParams } from "./enhance-mermaid"

/**
 * Svelte's `Action` type returns `void | ActionReturn`, so `.update`/`.destroy`
 * are unreadable off the raw call. `enhanceMermaid` always returns the object
 * form — narrow once here rather than at each of the call sites below.
 */
function attach(node: HTMLElement, params: MermaidParams): ActionReturn<MermaidParams> {
  return enhanceMermaid(node, params) as ActionReturn<MermaidParams>
}

afterEach(() => {
  // כל טסט מוסיף node ל-document.body ולא מנקה — jsdom חי לכל אורך הקובץ.
  document.body.innerHTML = ""
})

function makeNode(html: string): HTMLDivElement {
  const node = document.createElement("div")
  node.innerHTML = html
  document.body.appendChild(node)
  return node
}

function mermaidBlock(code: string): string {
  return `<pre><code class="hljs language-mermaid">${code}</code></pre>`
}

describe("enhanceMermaid", () => {
  it("בלוק language-mermaid → ה-<pre> הוחלף ב-wrapper עם data-mermaid-state=ready", async () => {
    const node = makeNode(mermaidBlock("flowchart TD\n  A-->B"))
    const render = vi.fn(async () => "<svg><g/></svg>")
    const action = attach(node, { text: "x", render })

    await vi.waitFor(() => {
      const wrapper = node.querySelector<HTMLElement>(".mermaid-diagram")
      expect(wrapper).not.toBeNull()
      expect(wrapper?.dataset.mermaidState).toBe("ready")
    })
    expect(node.querySelector("pre")).toBeNull()
    action.destroy?.()
  })

  it("בלוק שאינו mermaid (language-ts) → לא נגעו בו", async () => {
    const node = makeNode(`<pre><code class="hljs language-ts">const x = 1</code></pre>`)
    const render = vi.fn(async () => "<svg/>")
    const action = attach(node, { text: "x", render })

    expect(render).not.toHaveBeenCalled()
    expect(node.querySelector("pre code.language-ts")).not.toBeNull()
    action.destroy?.()
  })

  it("render שזורק → ה-<pre> שרד, state=error, ולא נזרקה שגיאה החוצה", async () => {
    const node = makeNode(mermaidBlock("bad syntax {{{"))
    const render = vi.fn(async () => {
      throw new Error("mermaid parse error")
    })

    expect(() => enhanceMermaid(node, { text: "x", render })).not.toThrow()

    await vi.waitFor(() => {
      const pre = node.querySelector<HTMLElement>("pre")
      expect(pre?.dataset.mermaidState).toBe("error")
    })
    // ה-<pre> לא הוחלף — בלוק-הקוד המקורי עדיין שם
    expect(node.querySelector("code.language-mermaid")).not.toBeNull()
    expect(node.querySelector(".mermaid-diagram")).toBeNull()
  })

  it("אותו תוכן פעמיים (שתי קריאות update) → render נקרא פעם אחת (מטמון)", async () => {
    const code = "flowchart TD\n  Cache-->Twice"
    const node = makeNode(mermaidBlock(code))
    const render = vi.fn(async () => "<svg><g/></svg>")
    const action = attach(node, { text: "1", render })

    await vi.waitFor(() => {
      expect(node.querySelector(".mermaid-diagram")).not.toBeNull()
    })
    expect(render).toHaveBeenCalledTimes(1)

    // הדמיית streaming: {@html} מפרסר-מחדש את אותו קוד (fresh <pre>)
    node.innerHTML = mermaidBlock(code)
    action.update?.({ text: "2", render })

    await vi.waitFor(() => {
      expect(node.querySelector(".mermaid-diagram")).not.toBeNull()
    })
    // cache-hit — render לא נקרא שוב
    expect(render).toHaveBeenCalledTimes(1)
    action.destroy?.()
  })

  it("מסמך בלי mermaid כלל → render לא נקרא אף פעם (שער-העצלות)", () => {
    const node = makeNode(`<p>plain text, no code blocks at all</p>`)
    const render = vi.fn(async () => "<svg/>")
    const action = attach(node, { text: "x", render })

    expect(render).not.toHaveBeenCalled()
    action.destroy?.()
  })

  it("ה-SVG שנכנס ל-DOM עבר sanitizeMermaidSvg — script לא נכנס", async () => {
    const node = makeNode(mermaidBlock("flowchart TD\n  Xss-->Attempt"))
    const render = vi.fn(async () => "<svg><script>alert(1)</script><g/></svg>")
    const action = attach(node, { text: "x", render })

    await vi.waitFor(() => {
      const wrapper = node.querySelector<HTMLElement>(".mermaid-diagram")
      expect(wrapper).not.toBeNull()
    })
    expect(node.querySelector("script")).toBeNull()
    expect(node.innerHTML).not.toContain("<script")
    action.destroy?.()
  })

  it("צומת מנותק: {@html} מחליף innerHTML בזמן ההמתנה → אין throw, אין החלפה של צומת מנותק", async () => {
    const node = makeNode(mermaidBlock("flowchart TD\n  Disconnected-->Race"))
    let resolveRender: ((svg: string) => void) | null = null
    const render = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRender = resolve
        }),
    )

    expect(() => enhanceMermaid(node, { text: "x", render })).not.toThrow()
    // ה-<pre> אמור להיות "pending" סינכרונית
    expect(node.querySelector("pre")?.dataset.mermaidState).toBe("pending")

    // הדמיית {@html} חדש — מנתק את ה-<pre> המקורי מה-DOM
    node.innerHTML = "<p>new content, no mermaid here</p>"

    // כעת ה-render מתיישב — לא אמור לזרוק ולא אמור לגעת ב-DOM המנותק
    expect(() => resolveRender?.("<svg><g/></svg>")).not.toThrow()
    // מאפשר ל-.then() המתוזמן להתרוקן (microtask) — אין מה לחכות-ל, אז flush ישיר
    await Promise.resolve()
    await Promise.resolve()
    // התוכן החדש (בתוך node) לא הוחלף בחזרה — אין wrapper בתוכו
    expect(node.querySelector(".mermaid-diagram")).toBeNull()
    expect(node.textContent).toContain("new content")
  })

  // ─── slice/msg-diagrams (Commit 2) — onExpand + expandLabel ─────────────
  describe("onExpand — לחיצה על תרשים מוכן → ContentViewer", () => {
    it("קליק על ה-wrapper קורא ל-onExpand עם ה-SVG המחוטא, ומוסיף role/tabindex/aria-label", async () => {
      const node = makeNode(mermaidBlock("flowchart TD\n  Expand-->Click"))
      const render = vi.fn(async () => "<svg><g/></svg>")
      const onExpand = vi.fn()
      const action = attach(node, {
        text: "x",
        render,
        onExpand,
        expandLabel: "הגדל תרשים",
      })

      const wrapper = await vi.waitFor(() => {
        const el = node.querySelector<HTMLElement>(".mermaid-diagram")
        expect(el).not.toBeNull()
        return el as HTMLElement
      })

      expect(wrapper.getAttribute("role")).toBe("button")
      expect(wrapper.tabIndex).toBe(0)
      expect(wrapper.getAttribute("aria-label")).toBe("הגדל תרשים")

      wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      expect(onExpand).toHaveBeenCalledTimes(1)
      expect(onExpand).toHaveBeenCalledWith(expect.stringContaining("<svg>"))
      action.destroy?.()
    })

    it("Enter/Space על ה-wrapper גם קוראים ל-onExpand (יעד-מגע נגיש)", async () => {
      const node = makeNode(mermaidBlock("flowchart TD\n  Keyboard-->Access"))
      const render = vi.fn(async () => "<svg><g/></svg>")
      const onExpand = vi.fn()
      const action = attach(node, { text: "x", render, onExpand })

      const wrapper = await vi.waitFor(() => {
        const el = node.querySelector<HTMLElement>(".mermaid-diagram")
        expect(el).not.toBeNull()
        return el as HTMLElement
      })

      wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      expect(onExpand).toHaveBeenCalledTimes(1)
      action.destroy?.()
    })

    it("בלי onExpand — אין role/tabindex/aria-label (התרשים לא לחיץ)", async () => {
      const node = makeNode(mermaidBlock("flowchart TD\n  No-->Expand"))
      const render = vi.fn(async () => "<svg><g/></svg>")
      const action = attach(node, { text: "x", render })

      const wrapper = await vi.waitFor(() => {
        const el = node.querySelector<HTMLElement>(".mermaid-diagram")
        expect(el).not.toBeNull()
        return el as HTMLElement
      })

      expect(wrapper.getAttribute("role")).toBeNull()
      expect(wrapper.getAttribute("aria-label")).toBeNull()
      action.destroy?.()
    })
  })
})
