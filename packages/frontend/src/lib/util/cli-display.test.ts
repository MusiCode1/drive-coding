/**
 * cli-display.test.ts — לוגיקה טהורה ל-<CliBadge> (slice cli-branding, Commit 2).
 *
 * אין תקדים בריפו למונוגרמה/ראשי-תיבות (grep "monogram|initials|charAt(0)" → 0) —
 * רכיב חדש לגמרי, כולל הטיפול בשם לא-לטיני/emoji.
 */
import { describe, expect, it } from "vitest"
import {
  cliColorHue,
  cliDisplayName,
  cliLogoKey,
  cliMonogram,
  isRemoteLogo,
  isStaticLogoPath,
  isTintableLogo,
  resolveCliLogoUrl,
} from "./cli-display"

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

describe("resolveCliLogoUrl (slice cli-logo-serving)", () => {
  it("https:// → as-is", () => {
    expect(resolveCliLogoUrl("pi", "https://cdn.example/logo.svg")).toBe(
      "https://cdn.example/logo.svg",
    )
  })

  it("/logos/… → same-origin static via beUrl", () => {
    expect(resolveCliLogoUrl("cursor-sdk", "/logos/cli/cursor-sdk.svg")).toBe(
      "/logos/cli/cursor-sdk.svg",
    )
  })

  it("נתיב-קובץ מקומי (לא /logos/) → /api/cli-logo/:id", () => {
    expect(resolveCliLogoUrl("pi", "/tmp/pi.png")).toBe("/api/cli-logo/pi")
  })
})

describe("isStaticLogoPath (slice cli-logo-theme)", () => {
  it("/logos/cli/claude.svg → true", () => {
    expect(isStaticLogoPath("/logos/cli/claude.svg")).toBe(true)
  })

  it("/tmp/x.png → false", () => {
    expect(isStaticLogoPath("/tmp/x.png")).toBe(false)
  })

  it("https://… → false", () => {
    expect(isStaticLogoPath("https://example.com/logo.svg")).toBe(false)
  })

  it("מחרוזת ריקה → false", () => {
    expect(isStaticLogoPath("")).toBe(false)
  })

  it("https://x/logos/cli/x.svg → false — לא startsWith /logos/", () => {
    expect(isStaticLogoPath("https://x/logos/cli/x.svg")).toBe(false)
  })
})

describe("isTintableLogo (slice cli-logo-theme)", () => {
  it("/logos/cli/claude.svg → true", () => {
    expect(isTintableLogo("/logos/cli/claude.svg")).toBe(true)
  })

  it("/logos/cli/prime-agent.svg → true", () => {
    expect(isTintableLogo("/logos/cli/prime-agent.svg")).toBe(true)
  })

  it("/logos/cli/qoder.svg → false — brand gradient", () => {
    expect(isTintableLogo("/logos/cli/qoder.svg")).toBe(false)
  })

  it("/tmp/x.png → false", () => {
    expect(isTintableLogo("/tmp/x.png")).toBe(false)
  })

  it("https://example.com/logo.svg → false", () => {
    expect(isTintableLogo("https://example.com/logo.svg")).toBe(false)
  })

  it("https://example.com/logos/cli/qoder.svg → false", () => {
    expect(isTintableLogo("https://example.com/logos/cli/qoder.svg")).toBe(false)
  })
})

describe("isRemoteLogo (slice cli-logo-serving, Commit 3)", () => {
  it("https:// → true", () => {
    expect(isRemoteLogo("https://example.com/logo.png")).toBe(true)
  })

  it("http:// → true", () => {
    expect(isRemoteLogo("http://example.com/logo.png")).toBe(true)
  })

  it("HTTPS:// (uppercase) → true — case-insensitive", () => {
    expect(isRemoteLogo("HTTPS://example.com/logo.png")).toBe(true)
  })

  it("נתיב מוחלט → false", () => {
    expect(isRemoteLogo("/abs/path.png")).toBe(false)
  })

  it("נתיב יחסי → false", () => {
    expect(isRemoteLogo("./rel.png")).toBe(false)
  })

  it("מחרוזת ריקה → false", () => {
    expect(isRemoteLogo("")).toBe(false)
  })

  it("file:/// → false — לא http", () => {
    expect(isRemoteLogo("file:///x")).toBe(false)
  })
})
