import { describe, expect, it } from "vitest"
import { findFilePathMatches, resolveFileUri } from "./file-path-links"

const raws = (t: string) => findFilePathMatches(t).map((m) => m.raw)

describe("findFilePathMatches", () => {
  it("תופס נתיב יחסי, אבסולוטי ו-file:// באותו משפט", () => {
    expect(raws("ראה AGENTS.md וגם /etc/notes.txt וגם file:///tmp/a.pdf")).toEqual([
      "AGENTS.md",
      "/etc/notes.txt",
      "file:///tmp/a.pdf",
    ])
  })

  it("אינו בולע סימן-פיסוק צמוד", () => {
    expect(raws("ראה AGENTS.md.")).toEqual(["AGENTS.md"])
    expect(raws("(docs/plan.md)")).toEqual(["docs/plan.md"])
  })

  it("אינו תופס URL מרוחק — הפרוקסי דוחה אותו ממילא ב-400", () => {
    expect(raws("https://example.com/a.png")).toEqual([])
    expect(raws("http://host/dir/b.pdf")).toEqual([])
  })

  it("אינו תופס סיומת שאינה ב-allowlist של הפרוקסי", () => {
    expect(raws("server.ts ו-index.html ו-notes.docx")).toEqual([])
  })

  it("תופס נתיב עמוק עם מקפים ונקודות", () => {
    expect(raws("docs-for-llm/plans/brief-local-file-proxy.md")).toEqual([
      "docs-for-llm/plans/brief-local-file-proxy.md",
    ])
  })

  it("🔴 רגרסיה — מקף מחבר בעברית אינו חוסם (ל-AGENTS.md / ו-/tmp/a.md)", () => {
    expect(raws("ראה ל-AGENTS.md ו-/tmp/a.md")).toEqual(["AGENTS.md", "/tmp/a.md"])
  })

  it("אינו מתחיל באמצע נתיב עם מקפים", () => {
    expect(raws("brief-local-file-proxy.md")).toEqual(["brief-local-file-proxy.md"])
  })

  it("./ יחסי נתפס שלם ולא נקטע ל-/", () => {
    expect(raws("./out/plot.png")).toEqual(["./out/plot.png"])
  })

  it("מחזיר אינדקסים שמכסים בדיוק את ה-token", () => {
    const t = "קרא x/y.md עכשיו"
    const [m] = findFilePathMatches(t)
    expect(m).toBeDefined()
    expect(t.slice(m?.start ?? 0, m?.end ?? 0)).toBe("x/y.md")
  })
})

describe("resolveFileUri", () => {
  it("file:// עובר כמות שהוא", () => {
    expect(resolveFileUri("file:///tmp/a.md", "/home/u/p")).toBe("file:///tmp/a.md")
  })

  it("נתיב אבסולוטי מקבל קידומת file://", () => {
    expect(resolveFileUri("/tmp/a.md", null)).toBe("file:///tmp/a.md")
  })

  it("יחסי נפתר מול ה-cwd, גם כשה-cwd מסתיים בלוכסן", () => {
    expect(resolveFileUri("a.md", "/home/u/p")).toBe("file:///home/u/p/a.md")
    expect(resolveFileUri("a.md", "/home/u/p/")).toBe("file:///home/u/p/a.md")
  })

  it("יחסי בלי cwd — null, לא ניחוש", () => {
    expect(resolveFileUri("a.md", null)).toBeNull()
    expect(resolveFileUri("a.md", "")).toBeNull()
  })

  it("./ מנורמל מול ה-cwd", () => {
    expect(resolveFileUri("./out/plot.png", "/home/u/p")).toBe("file:///home/u/p/out/plot.png")
  })

  it("‏~ אינו נפתר — ל-FE אין את ה-home של השרת", () => {
    expect(resolveFileUri("~/notes.md", "/home/u/p")).toBeNull()
  })
})
