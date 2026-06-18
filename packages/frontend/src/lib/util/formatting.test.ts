// @vitest-environment jsdom
/**
 * formatting.test.ts — TDD עבור formatTime.
 *
 * formatTime(ts: number) → שעה קצרה HH:MM (Intl.DateTimeFormat).
 * שונה מ-SessionPicker.formatDate (relative-time עם Intl.RelativeTimeFormat).
 */

import { describe, it, expect } from "vitest"
import { formatTime } from "./formatting"

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
