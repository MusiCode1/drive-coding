/**
 * cli-display.test.ts — לוגיקה טהורה ל-<CliBadge> (slice cli-branding, Commit 2).
 *
 * אין תקדים בריפו למונוגרמה/ראשי-תיבות (grep "monogram|initials|charAt(0)" → 0) —
 * רכיב חדש לגמרי, כולל הטיפול בשם לא-לטיני/emoji.
 */
import { describe, expect, it } from "vitest"
import { cliColorHue, cliDisplayName, cliLogoKey, cliMonogram } from "./cli-display"

describe("cliDisplayName", () => {
  it("displayName קיים → מוחזר כמו שהוא", () => {
    expect(cliDisplayName("pi", "Pi")).toBe("Pi")
  })

  it("displayName חסר → נופל למזהה", () => {
    expect(cliDisplayName("pi", undefined)).toBe("pi")
  })

  it("displayName ריק ('') → נופל למזהה (ריק זה כמו חסר)", () => {
    expect(cliDisplayName("pi", "")).toBe("pi")
  })
})

describe("cliMonogram", () => {
  it("שם חד-מילתי → עד 2 תווים ראשונים, uppercase", () => {
    expect(cliMonogram("opencode")).toBe("OP")
  })

  it("שם דו-מילתי → ראשי-תיבות של שתי המילים, uppercase", () => {
    expect(cliMonogram("Open Code")).toBe("OC")
  })

  it("תו-בודד → אותו תו, uppercase", () => {
    expect(cliMonogram("x")).toBe("X")
  })

  it("שם לא-לטיני (עברית) → 2 תווים ראשונים ללא שינוי (אין case בעברית)", () => {
    expect(cliMonogram("פיתון")).toBe("פי")
  })

  it("emoji בתחילת השם → לא שובר surrogate pair", () => {
    const result = cliMonogram("🚀 Rocket")
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("🚀")
  })

  it("מחרוזת ריקה → מחרוזת ריקה (לא קורס)", () => {
    expect(cliMonogram("")).toBe("")
  })

  it("רק whitespace → מחרוזת ריקה", () => {
    expect(cliMonogram("   ")).toBe("")
  })
})

describe("cliColorHue", () => {
  it("דטרמיניסטי — אותו id תמיד אותו גוון", () => {
    expect(cliColorHue("opencode")).toBe(cliColorHue("opencode"))
  })

  it("בטווח 0-359", () => {
    const hue = cliColorHue("claude")
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })

  it("id שונה → (בדרך כלל) גוון שונה — סניטי, לא ערבוב לצבע קבוע", () => {
    expect(cliColorHue("opencode")).not.toBe(cliColorHue("claude"))
  })
})

describe("cliLogoKey (slice cli-logo-serving, Commit 1)", () => {
  // מפתח-איפוס ל-`failed` ב-<CliBadge>: כש-id או logo משתנים, המפתח חייב
  // להשתנות — אחרת אחרי החלפת CLI שבור, ה-monogram-fallback "דבק" לצמיתות
  // (בג #4 שאיגיל תפסה — DoD #9 בודק מחיקה, לא החלפה, ולא היה תופס את זה).
  it("אותו id + אותו logo → אותו מפתח", () => {
    expect(cliLogoKey("pi", "/tmp/pi.png")).toBe(cliLogoKey("pi", "/tmp/pi.png"))
  })

  it("id שונה, logo זהה → מפתח שונה", () => {
    expect(cliLogoKey("pi", "/tmp/x.png")).not.toBe(cliLogoKey("qoder", "/tmp/x.png"))
  })

  it("id זהה, logo שונה → מפתח שונה", () => {
    expect(cliLogoKey("pi", "/tmp/a.png")).not.toBe(cliLogoKey("pi", "/tmp/b.png"))
  })

  it("logo undefined לעומת logo מוגדר → מפתח שונה", () => {
    expect(cliLogoKey("pi", undefined)).not.toBe(cliLogoKey("pi", "/tmp/pi.png"))
  })

  it("logo undefined → מפתח יציב (לא קורס, לא NaN/undefined כמחרוזת)", () => {
    expect(cliLogoKey("pi", undefined)).toBe(cliLogoKey("pi", undefined))
    expect(typeof cliLogoKey("pi", undefined)).toBe("string")
  })

  it("אין התנגשות-שרשור מקרית: (id='a',logo='bc') שונה מ-(id='ab',logo='c')", () => {
    // שרשור נאיבי (id+logo) היה מייצר "abc" משני הצדדים — המפריד מונע התנגשות זו.
    expect(cliLogoKey("a", "bc")).not.toBe(cliLogoKey("ab", "c"))
  })
})
