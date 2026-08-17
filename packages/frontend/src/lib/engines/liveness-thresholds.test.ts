/**
 * liveness-thresholds.test.ts — שומר-הסדר בין ספי-החיוּת.
 *
 * 🔴 אביגיל ממצא 3: הסלייס `stream-liveness` הכניס סף שלישי (75ש׳) לצד שניים
 * קיימים (90ש׳ · 5ש׳), **ושלושתם יורים על אותו אירוע** — "משהו לא זז". הם
 * נכתבו בשלושה סלייסים, בשלושה קבצים, בלי שאיש ראה את השלושה יחד.
 *
 * הטסט הזה קיים כדי שסף רביעי שייכתב באותה דרך **יפיל build** ולא יתגלה בשדה.
 */
import { describe, expect, it } from "vitest"
import {
  checkThresholdOrder,
  PRESENCE_BANNER_DELAY_MS,
  SERVER_KEEPALIVE_MS,
  STREAM_STALE_MS,
  TURN_STALL_HARD_CAP_MS,
  TURN_STALL_NOTICE_MS,
} from "./liveness-thresholds.js"

describe("ספי-חיוּת — הסדר הוא התוכן", () => {
  it("רשת → תעבורה → אפליקציה → גג", () => {
    expect(checkThresholdOrder()).toEqual([])
  })

  it("🔴 שתיקת-זרם נתפסת **לפני** תור-ששקע", () => {
    // אחרת נאשים את הסוכן ב"שקע" בזמן שבכלל אין חיבור.
    expect(STREAM_STALE_MS).toBeLessThan(TURN_STALL_NOTICE_MS)
  })

  it("באנר-הרשת נתפס לפני שתיקת-הזרם", () => {
    // אחרת נכריז "הצינור מת" בזמן שהאמת היא "הרשת נופלת".
    expect(PRESENCE_BANNER_DELAY_MS).toBeLessThan(STREAM_STALE_MS)
  })

  it("סף-השתיקה סובל איבוד keepalive אחד, לא שניים", () => {
    expect(STREAM_STALE_MS).toBeGreaterThan(SERVER_KEEPALIVE_MS * 2)
    expect(STREAM_STALE_MS).toBeLessThan(SERVER_KEEPALIVE_MS * 3)
  })

  it("הגג אחרון", () => {
    expect(TURN_STALL_NOTICE_MS).toBeLessThan(TURN_STALL_HARD_CAP_MS)
  })
})
