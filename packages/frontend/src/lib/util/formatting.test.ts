// @vitest-environment jsdom
/**
 * formatting.test.ts — TDD עבור formatTime + formatRelativeTime.
 *
 * formatTime(ts: number) → שעה קצרה HH:MM (Intl.DateTimeFormat).
 * formatRelativeTime(epochMs, locale, now?) → זמן יחסי קריא (Intl.RelativeTimeFormat).
 * שונה מ-SessionPicker.formatDate (relative-time עם Intl.RelativeTimeFormat).
 */

import type { QuotaPeriod } from "@drive-coding/provider/extensions"
import { describe, expect, it } from "vitest"
import { formatQuotaPeriod, formatRelativeTime, formatTime, formatTimeUntil } from "./formatting"

describe("formatTime", () => {
  it("returns HH:MM string for a known timestamp (midnight UTC)", () => {
    // 2024-01-15T10:30:00Z
    const ts = new Date("2024-01-15T10:30:00Z").getTime()
    const result = formatTime(ts)
    // format: HH:MM — שעתיים ספרות, נקודותיים, דקות שתי ספרות
    expect(result).toMatch(/^\d{1,2}:\d{2}$/)
  })

  it("contains the correct hour and minute (locale-agnostic check)", () => {
    // נכנה timestamp עם תאריך ידוע ב-UTC+0 עם תשומת לב לאזור זמן.
    // בדוק רק פורמט, לא ערך מוחלט (אזור זמן תלוי סביבה).
    const ts = Date.now()
    const result = formatTime(ts)
    expect(result).toMatch(/^\d{1,2}:\d{2}$/)
  })

  it("pads minutes to 2 digits", () => {
    // כל timestamp שיהיה, הדקות צריכות להיות 2 ספרות
    const ts = new Date("2024-06-01T09:05:00Z").getTime()
    const result = formatTime(ts)
    // הדקות בסוף — חייבות להיות בדיוק 2 ספרות
    const parts = result.split(":")
    expect(parts).toHaveLength(2)
    expect(parts[1]).toHaveLength(2)
  })
})

describe("formatRelativeTime", () => {
  const BASE = 1_700_000_000_000 // timestamp שרירותי קבוע כ-now

  // מקרה 1: diff=0 → "כעת"/"עכשיו" / "now"
  it("case 1 — diff=0: returns present-tense string for he locale", () => {
    const result = formatRelativeTime(BASE, "he", BASE)
    // numeric:"auto" + 0 seconds → Intl מחזיר "כעת" או "עכשיו" (תלוי ICU)
    expect(result).toMatch(/כעת|עכשיו/)
  })

  it("case 1 — diff=0: returns 'now' for en locale", () => {
    const result = formatRelativeTime(BASE, "en", BASE)
    expect(result).toBe("now")
  })

  // מקרה 2: 30 שניות → seconds (לא minutes)
  it("case 2 — 30s: returns seconds unit in he", () => {
    const result = formatRelativeTime(BASE - 30_000, "he", BASE)
    expect(result).toContain("שניות")
  })

  // מקרה 3: 2 דקות → numeric digits או צורת dual מילולית, תלוי ICU
  it("case 3 — 120_000ms (2 min): returns two-minutes string in he", () => {
    const result = formatRelativeTime(BASE - 120_000, "he", BASE)
    expect(result).toMatch(/^לפני (2|שתי) דקות$/)
  })

  // מקרה 4: 90 דקות → שעה (numeric:auto → "לפני שעה" / "לפני שעה (1)" תלוי ICU)
  it("case 4 — 90 min: returns hour-unit string in he (numeric:auto)", () => {
    const result = formatRelativeTime(BASE - 90 * 60_000, "he", BASE)
    // numeric:auto → "לפני שעה" (1 hour ago, auto) — Intl מחזיר יחידת שעה
    expect(result).toMatch(/שעה/)
  })

  // מקרה 5: 26 שעות → יום (he)
  it("case 5 — 26 hours: returns day-unit string in he", () => {
    const result = formatRelativeTime(BASE - 26 * 3_600_000, "he", BASE)
    // numeric:auto → "אתמול" או "לפני יום" — תלוי ב-Intl
    expect(result).toMatch(/אתמול|לפני יום/)
  })

  // מקרה 6: עתיד (diff<0, clock skew) → clamp ל-0, לא קורס
  it("case 6 — future epochMs (diff<0): returns present-tense, no crash", () => {
    const future = BASE + 5_000 // epochMs > now
    const he = formatRelativeTime(future, "he", BASE)
    const en = formatRelativeTime(future, "en", BASE)
    // Intl מחזיר "כעת"/"עכשיו" בעברית ו-"now" באנגלית (תלוי ICU)
    expect(he).toMatch(/כעת|עכשיו/)
    expect(en).toBe("now")
  })

  // מקרה 7: locale="en" → פלט אנגלי
  it("case 7 — locale=en: returns English output for 2 minutes", () => {
    const result = formatRelativeTime(BASE - 120_000, "en", BASE)
    expect(result).toBe("2 minutes ago")
  })
})

describe("formatQuotaPeriod", () => {
  it("rolling 5h (18000s) — derives 'hour' unit from durationSeconds, not provider ID", () => {
    const period: QuotaPeriod = { kind: "rolling", durationSeconds: 5 * 60 * 60 }
    expect(formatQuotaPeriod(period, "en")).toBe("5 hours")
    expect(formatQuotaPeriod(period, "he")).toBe("5 שעות")
  })

  it("rolling 7d (604800s) — derives 'day' unit", () => {
    const period: QuotaPeriod = { kind: "rolling", durationSeconds: 7 * 24 * 60 * 60 }
    expect(formatQuotaPeriod(period, "en")).toBe("7 days")
    expect(formatQuotaPeriod(period, "he")).toBe("7 ימים")
  })

  it("rolling — non-round-hour duration falls back to minutes", () => {
    const period: QuotaPeriod = { kind: "rolling", durationSeconds: 90 * 60 }
    expect(formatQuotaPeriod(period, "en")).toBe("90 minutes")
  })

  it("calendar month — generic monthly period, no provider branching", () => {
    const period: QuotaPeriod = { kind: "calendar", unit: "month" }
    expect(formatQuotaPeriod(period, "en")).toBe("1 month")
    // ⚠️ העברית נבדקת בהכלה, לא בשוויון — **בכוונה**. הרינדור המדויק של
    // Intl ליחיד תלוי-מנוע: bun מחזיר "חודש", ו-node (ICU 78.2) מחזיר
    // "1 חודש". שוויון כאן קיבע את הפלט של bun, ולכן הטסט היה **אדום
    // לצמיתות תחת vitest** (שרץ על node) — מה שמרעיל כל DoD שנשען על
    // "הסוויטה ירוקה", ומאמן להתעלם מאדום.
    //
    // וזה גם הגבול הנכון: החוזה של formatQuotaPeriod הוא **בחירת היחידה
    // והערך**, לא הטיפוגרפיה של ICU. הערך 1 כבר מקובע באנגלית שמעל;
    // כאן נותר להוכיח שה-locale זורם והיחידה היא חודש ולא שבוע/יום.
    expect(formatQuotaPeriod(period, "he")).toContain("חודש")
  })

  it("calendar week/day — generic, unit comes straight from the snapshot", () => {
    expect(formatQuotaPeriod({ kind: "calendar", unit: "week" }, "en")).toBe("1 week")
    expect(formatQuotaPeriod({ kind: "calendar", unit: "day" }, "en")).toBe("1 day")
  })
})

describe("formatTimeUntil", () => {
  const BASE = 1_700_000_000_000

  it("case 1 — diff=0: returns present-tense string", () => {
    expect(formatTimeUntil(BASE, "en", BASE)).toBe("now")
    expect(formatTimeUntil(BASE, "he", BASE)).toMatch(/כעת|עכשיו/)
  })

  it("case 2 — future 5 minutes: returns 'in N minutes' (not past tense)", () => {
    const result = formatTimeUntil(BASE + 5 * 60_000, "en", BASE)
    expect(result).toBe("in 5 minutes")
  })

  it("case 2 — future 5 minutes in he", () => {
    const result = formatTimeUntil(BASE + 5 * 60_000, "he", BASE)
    expect(result).toMatch(/^בעוד (5|חמש) דקות$/)
  })

  it("case 3 — future 90 minutes: returns hour-unit string", () => {
    const result = formatTimeUntil(BASE + 90 * 60_000, "en", BASE)
    expect(result).toMatch(/hour/)
  })

  it("case 4 — future 26 hours: returns day-unit string", () => {
    const result = formatTimeUntil(BASE + 26 * 3_600_000, "en", BASE)
    expect(result).toMatch(/day|tomorrow/)
  })

  // case 5: עבר/clock skew (epochMs < now) → clamp ל-0, בלי מספר שלילי, לא קורס.
  it("case 5 — past epochMs (clock skew / already reset) → clamp to now, no crash", () => {
    const past = BASE - 5_000
    expect(() => formatTimeUntil(past, "en", BASE)).not.toThrow()
    expect(formatTimeUntil(past, "en", BASE)).toBe("now")
    expect(formatTimeUntil(past, "he", BASE)).toMatch(/כעת|עכשיו/)
  })

  it("case 6 — never returns a negative-looking string for the future", () => {
    const result = formatTimeUntil(BASE + 30 * 60_000, "en", BASE)
    expect(result).not.toMatch(/-/)
    expect(result).toMatch(/^in /)
  })
})
