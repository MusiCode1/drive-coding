import { describe, expect, it } from "vitest"
import { transcriptLines } from "./voice-transcript"

describe("transcriptLines", () => {
  it("splits speaker lines and keeps unlabeled ones", () => {
    expect(transcriptLines("user:  Hey ,בדיקה\nassistant:   כן, שומע\n\nfree text")).toEqual([
      { role: "user", text: "Hey ,בדיקה" },
      { role: "assistant", text: "כן, שומע" },
      { role: null, text: "free text" },
    ])
  })

  it("returns nothing for a missing context", () => {
    expect(transcriptLines(undefined)).toEqual([])
    expect(transcriptLines("   ")).toEqual([])
  })
})
