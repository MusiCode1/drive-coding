// @vitest-environment jsdom
/**
 * mermaid-sanitize.test.ts — TDD ל-sanitizeMermaidSvg מול פיקסצ'רים אמיתיים.
 *
 * mermaid לא מרנדר ב-jsdom (getBBox חסר) — לכן הטסטים האלה לא קוראים ל-mermaid.render()
 * בכלל. הם בודקים את ה-sanitize *לאחר* הרינדור, מול SVG שנוצר מראש בכרומיום אמיתי
 * ומוקפא כפיקסצ'ר (ר' brief-msg-diagrams.md §11-ג + §4 Commit 0).
 */
import { describe, expect, it } from "vitest"
import fixtures from "./__fixtures__/mermaid-svg.json"
import { sanitizeMermaidSvg } from "./mermaid-sanitize"

type Fixture = { ok?: boolean; svg?: string }
const F = fixtures as Record<string, Fixture>

/** מוסכמת __-prefix (brief §4 Commit 0 שלב 1): מפתח שמתחיל ב-__ אינו תרשים תקין. */
const REAL_DIAGRAMS = Object.keys(F).filter((k) => !k.startsWith("__"))
const JOURNEY = "journey"
const REAL_DIAGRAMS_EXCEPT_JOURNEY = REAL_DIAGRAMS.filter((k) => k !== JOURNEY)

/** גזירה ע"י פרסינג ל-DOM (לא regex) — tagName + attributes, per §4 Commit 0 אזהרה. */
function tagsAndAttrsOf(svg: string): { tags: Set<string>; attrs: Set<string> } {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml")
  const tags = new Set<string>()
  const attrs = new Set<string>()
  for (const el of doc.querySelectorAll("*")) {
    tags.add(el.tagName.toUpperCase())
    for (const a of el.attributes) attrs.add(a.name.toLowerCase())
  }
  return { tags, attrs }
}

function svgOf(key: string): string {
  const svg = F[key]?.svg
  if (svg === undefined) throw new Error(`fixture ${key} has no svg field`)
  return svg
}

describe("sanitizeMermaidSvg — אפס אובדן ב-10 (כל התרשימים התקינים פרט ל-journey)", () => {
  for (const key of REAL_DIAGRAMS_EXCEPT_JOURNEY) {
    it(`${key} — tags+attrs זהים לפני/אחרי`, () => {
      const raw = svgOf(key)
      const before = tagsAndAttrsOf(raw)
      const clean = sanitizeMermaidSvg(raw)
      const after = tagsAndAttrsOf(clean)
      expect(after.tags).toEqual(before.tags)
      expect(after.attrs).toEqual(before.attrs)
    })
  }
})

describe("sanitizeMermaidSvg — חריגת-journey כשוויון-מדויק (brief DoD 2ב)", () => {
  it("journey מאבד בדיוק {foreignObject, switch, DIV} — לא פחות ולא יותר", () => {
    const raw = svgOf(JOURNEY)
    const before = tagsAndAttrsOf(raw)
    const clean = sanitizeMermaidSvg(raw)
    const after = tagsAndAttrsOf(clean)
    const lostTags = new Set([...before.tags].filter((t) => !after.tags.has(t)))
    expect(lostTags).toEqual(new Set(["FOREIGNOBJECT", "SWITCH", "DIV"]))
    // attrs לא אמורים להיפגע — ההפסד היחיד הוא tags
    expect(after.attrs).toEqual(before.attrs)
  })
})

describe("sanitizeMermaidSvg — ערוץ-הרשת של themeCSS (brief §3-ד, DoD 3ב)", () => {
  it("אין url( בתוכן ה-<style> המוטמע אחרי sanitize", () => {
    const evil = `<svg><style>#a{background-image:url(http://evil/x)}</style><g/></svg>`
    const clean = sanitizeMermaidSvg(evil)
    expect(clean).not.toContain("url(")
  })
})

describe("sanitizeMermaidSvg — עוין נחסם", () => {
  const HOSTILE_KEYS = ["xssHtmlLabel", "xssScript", "__htmlLabelsTrue"]
  for (const key of HOSTILE_KEYS) {
    it(`${key} — אין <script, on*=, javascript:, foreignObject`, () => {
      const clean = sanitizeMermaidSvg(svgOf(key))
      expect(clean).not.toContain("<script")
      expect(clean).not.toMatch(/\son[a-z]+\s*=/i)
      expect(clean).not.toContain("javascript:")
      expect(clean.toLowerCase()).not.toContain("foreignobject")
    })
  }

  it("__htmlLabelsTrue — ההוכחה ש-MERMAID_ALLOW חוסם div/span/p/img/a גם עם htmlLabels:true", () => {
    const clean = sanitizeMermaidSvg(svgOf("__htmlLabelsTrue"))
    const after = tagsAndAttrsOf(clean)
    for (const banned of ["DIV", "SPAN", "P", "IMG", "A"]) {
      expect(after.tags.has(banned)).toBe(false)
    }
  })
})

describe("sanitizeMermaidSvg — <style> שורד", () => {
  for (const key of REAL_DIAGRAMS) {
    it(`${key} — אורך תוכן ה-<style> זהה, @keyframes נשאר`, () => {
      const raw = svgOf(key)
      const clean = sanitizeMermaidSvg(raw)
      const rawStyle = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ""
      const cleanStyle = clean.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ""
      expect(cleanStyle.length).toBe(rawStyle.length)
      expect(cleanStyle).toContain("@keyframes")
    })
  }
})

describe("sanitizeMermaidSvg — __pwned (אין שדה svg כלל)", () => {
  it("לא מתרסק אם קוראים לו בטעות — אבל אין לו svg לבדוק", () => {
    expect(F["__pwned"]?.svg).toBeUndefined()
  })
})
