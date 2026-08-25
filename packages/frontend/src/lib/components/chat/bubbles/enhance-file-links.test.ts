// @vitest-environment jsdom
/**
 * enhance-file-links.test.ts — הרצה אמיתית של ה-action על DOM.
 *
 * §8ה: מה שנכתב לשער — מורץ. הפונקציה הטהורה נבדקת ב-file-path-links.test.ts;
 * כאן נבדק שהיא באמת מוזרקת ל-DOM ושהלחיצה מגיעה ל-callback.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { enhanceFileLinks, type FileLinkParams } from "./enhance-file-links"

const CWD = "/home/u/proj"

function mount(html: string, over: Partial<FileLinkParams> = {}) {
  const node = document.createElement("div")
  node.innerHTML = html
  document.body.append(node)
  const onOpen = vi.fn()
  const params: FileLinkParams = {
    text: node.textContent ?? "",
    cwd: CWD,
    onOpen,
    label: "file",
    ...over,
  }
  const handle = enhanceFileLinks(node, params)
  return { node, onOpen, handle, params }
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("enhanceFileLinks", () => {
  it("הופך נתיב יחסי לכפתור עם URI פתור מול ה-cwd", () => {
    const { node } = mount("<p>ראה AGENTS.md בבקשה</p>")
    const btn = node.querySelector<HTMLElement>("[data-file-link]")
    expect(btn).not.toBeNull()
    expect(btn?.dataset["fileLink"]).toBe("file:///home/u/proj/AGENTS.md")
    expect(btn?.textContent).toBe("AGENTS.md")
    // הטקסט שמסביב נשמר
    expect(node.textContent).toBe("ראה AGENTS.md בבקשה")
  })

  it("לחיצה מעבירה את ה-URI ל-onOpen", () => {
    const { node, onOpen } = mount("<p>/tmp/a.md</p>")
    node.querySelector<HTMLElement>("[data-file-link]")?.click()
    expect(onOpen).toHaveBeenCalledWith("file:///tmp/a.md")
  })

  it("אינו נוגע בבלוק-קוד", () => {
    const { node } = mount("<pre><code>cat AGENTS.md</code></pre>")
    expect(node.querySelector("[data-file-link]")).toBeNull()
  })

  it("אינו נוגע בקישור קיים", () => {
    const { node } = mount('<p><a href="https://x/y">a.md</a></p>')
    expect(node.querySelector("[data-file-link]")).toBeNull()
  })

  it("בלי cwd — נתיב יחסי אינו מלונקק, אבסולוטי כן", () => {
    const { node } = mount("<p>a.md ו-/tmp/b.md</p>", { cwd: null })
    const links = [...node.querySelectorAll<HTMLElement>("[data-file-link]")]
    expect(links.map((l) => l.dataset["fileLink"])).toEqual(["file:///tmp/b.md"])
  })

  it("update אחרי החלפת {@html} מזריק מחדש, בלי כפילות", () => {
    const { node, handle, params } = mount("<p>a.md</p>")
    node.innerHTML = "<p>b.md ו-c.md</p>" // מדמה החלפת innerHTML ע"י Svelte
    handle?.update?.({ ...params, text: "b.md ו-c.md" })
    expect(node.querySelectorAll("[data-file-link]")).toHaveLength(2)
  })

  it("destroy מסיר את מאזין-הלחיצה", () => {
    const { node, onOpen, handle } = mount("<p>/tmp/a.md</p>")
    handle?.destroy?.()
    node.querySelector<HTMLElement>("[data-file-link]")?.click()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("enabled:false — absolute path is not linkified", () => {
    const { node } = mount("<p>/tmp/a.md</p>", { enabled: false })
    expect(node.querySelector("[data-file-link]")).toBeNull()
  })

  // ─── slice msg-media (‏תיקון-פריוויו 3): ‏בועת-הסוכן ───
  // §1 ‏של פקודת-המשימה: "‏כשהסוכן מזכיר מסמך — ‏לחיצה פותחת אותו מרונדר, ‏לא כנתיב מת".
  // ‏בצד הסוכן: ‏אבסולוטי בלבד — ‏יחסי ממתין ל-fs-stat (‏אימות-קיום).
  it("agent bubble: נתיב אבסולוטי → קישור עם onOpen פעיל", () => {
    const { node, onOpen } = mount("<p>ראה /home/u/proj/AGENTS.md בבקשה</p>", {
      absoluteOnly: true,
    })
    const btn = node.querySelector<HTMLElement>("[data-file-link]")
    expect(btn).not.toBeNull()
    expect(btn?.dataset["fileLink"]).toBe("file:///home/u/proj/AGENTS.md")
    btn?.click()
    expect(onOpen).toHaveBeenCalledWith("file:///home/u/proj/AGENTS.md")
  })

  it("agent bubble: file:/// מפורש → קישור", () => {
    const { node } = mount("<p>ראה file:///etc/notes.md</p>", { absoluteOnly: true })
    expect(node.querySelector("[data-file-link]")).not.toBeNull()
  })

  it("agent bubble: נתיב יחסי → לא קישור, גם כשיש cwd", () => {
    const { node } = mount("<p>ראה AGENTS.md וגם ./local.md ו-docs/x.md</p>", {
      absoluteOnly: true,
    })
    expect(node.querySelector("[data-file-link]")).toBeNull()
    expect(node.textContent).toContain("AGENTS.md")
  })

  it("user bubble (absoluteOnly לא מסופק): יחסי עדיין מלונקק — אין רגרסיה", () => {
    const { node } = mount("<p>ראה AGENTS.md בבקשה</p>")
    const btn = node.querySelector<HTMLElement>("[data-file-link]")
    expect(btn?.dataset["fileLink"]).toBe("file:///home/u/proj/AGENTS.md")
  })
})
