/**
 * disconnect-banner.test.ts — החלטת איזה באנר להציג (slice gone-banner).
 *
 * 🔴 ממצא 2: gone חייב לנצח את turnStalled. סוכן שנמחק באמצע תור היה מקבל
 * "ייתכן שהוא עדיין עובד" אם הענף הרביעי היה אחרי turnStalled.
 */
import { describe, expect, it } from "vitest"
import { pickBannerView } from "./disconnect-banner.js"

describe("pickBannerView", () => {
  it('🔴 gone קודם ל-turnStalled — pickBannerView("gone", true) === "gone"', () => {
    expect(pickBannerView("gone", true)).toBe("gone")
  })

  it("turnStalled כשאין באנר-ניתוק", () => {
    expect(pickBannerView(null, true)).toBe("turnStalled")
  })

  it("אין באנר בכלל", () => {
    expect(pickBannerView(null, false)).toBeNull()
  })

  it("reconnecting מנצח turnStalled (לא נשברה ההתנהגות)", () => {
    expect(pickBannerView("reconnecting", true)).toBe("reconnecting")
  })

  it("cloudflare מנצח turnStalled", () => {
    expect(pickBannerView("cloudflare", true)).toBe("cloudflare")
  })
})
