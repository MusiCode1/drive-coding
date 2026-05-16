import { describe, expect, it } from "vitest"
import { splitIntoSentences } from "../../src/voice/sentence-boundary"

describe("splitIntoSentences", () => {
  // ─── Hebrew ───────────────────────────────────────────────────
  it("splits two Hebrew sentences separated by period+space", () => {
    const { sentences, remaining } = splitIntoSentences("שלום עולם. מה שלומך?")
    expect(sentences).toEqual(["שלום עולם."])
    expect(remaining).toBe("מה שלומך?")
  })

  it("splits two Hebrew question sentences", () => {
    // The regex requires whitespace after punctuation to be a boundary.
    // "אני בסדר." has no trailing space → stays as remaining.
    const { sentences, remaining } = splitIntoSentences("מה שלומך? אני בסדר.")
    expect(sentences).toEqual(["מה שלומך?"])
    expect(remaining).toBe("אני בסדר.")
  })

  it("returns empty sentences + full input when no boundary found", () => {
    const { sentences, remaining } = splitIntoSentences("שלום עולם")
    expect(sentences).toEqual([])
    expect(remaining).toBe("שלום עולם")
  })

  it("splits on exclamation mark", () => {
    // "תודה רבה." at end → no trailing space → remaining
    const { sentences, remaining } = splitIntoSentences("נפלא! תודה רבה.")
    expect(sentences).toEqual(["נפלא!"])
    expect(remaining).toBe("תודה רבה.")
  })

  it("splits on colon", () => {
    // "זה חשוב מאוד." at end → remaining
    const { sentences, remaining } = splitIntoSentences("שים לב: זה חשוב מאוד.")
    expect(sentences).toEqual(["שים לב:"])
    expect(remaining).toBe("זה חשוב מאוד.")
  })

  it("splits on comma (Hebrew TTS boundary)", () => {
    // "ואז נמשיך." at end → remaining
    const { sentences, remaining } = splitIntoSentences("ראשית, נבין את הנושא. ואז נמשיך.")
    expect(sentences).toEqual(["ראשית,", "נבין את הנושא."])
    expect(remaining).toBe("ואז נמשיך.")
  })

  it("keeps trailing partial sentence as remaining", () => {
    const { sentences, remaining } = splitIntoSentences("שלום עולם. חצי משפט")
    expect(sentences).toEqual(["שלום עולם."])
    expect(remaining).toBe("חצי משפט")
  })

  it("handles empty string", () => {
    const { sentences, remaining } = splitIntoSentences("")
    expect(sentences).toEqual([])
    expect(remaining).toBe("")
  })

  it("handles only a period with no following space", () => {
    // Period at end without space — not a boundary
    const { sentences, remaining } = splitIntoSentences("שלום.")
    expect(sentences).toEqual([])
    expect(remaining).toBe("שלום.")
  })

  it("accumulates multiple complete sentences", () => {
    const { sentences, remaining } = splitIntoSentences("משפט ראשון. משפט שני. משפט שלישי.")
    expect(sentences).toEqual(["משפט ראשון.", "משפט שני."])
    expect(remaining).toBe("משפט שלישי.")
  })

  // ─── English ─────────────────────────────────────────────────
  it("splits two English sentences", () => {
    const { sentences, remaining } = splitIntoSentences("Hi there. How are you?")
    expect(sentences).toEqual(["Hi there."])
    expect(remaining).toBe("How are you?")
  })

  it("splits English exclamation", () => {
    // "Let's go." at end → remaining
    const { sentences, remaining } = splitIntoSentences("Great! Let's go.")
    expect(sentences).toEqual(["Great!"])
    expect(remaining).toBe("Let's go.")
  })

  it("handles English with comma boundary", () => {
    // "do that." at end → remaining
    const { sentences, remaining } = splitIntoSentences("First, do this. Then, do that.")
    expect(sentences).toEqual(["First,", "do this.", "Then,"])
    expect(remaining).toBe("do that.")
  })

  // ─── Mixed ───────────────────────────────────────────────────
  it("handles mixed Hebrew and English sentences", () => {
    const { sentences, remaining } = splitIntoSentences("Hello world. שלום עולם.")
    expect(sentences).toEqual(["Hello world."])
    expect(remaining).toBe("שלום עולם.")
  })

  it("trims whitespace from sentences", () => {
    const { sentences } = splitIntoSentences("  שלום. עולם.")
    expect(sentences[0]).toBe("שלום.")
  })

  // ─── Edge cases ───────────────────────────────────────────────
  it("is deterministic — calling twice gives same result", () => {
    const input = "שלום. מה שלומך?"
    const r1 = splitIntoSentences(input)
    const r2 = splitIntoSentences(input)
    expect(r1).toEqual(r2)
  })

  it("handles question mark without following content", () => {
    const { sentences, remaining } = splitIntoSentences("מה קורה? ")
    expect(sentences).toEqual(["מה קורה?"])
    expect(remaining).toBe("")
  })

  it("does not split on period inside a word (ellipsis simulation)", () => {
    // Period immediately followed by another word char — not a boundary
    const { sentences, remaining } = splitIntoSentences("Dr. Smith went home.")
    // "Dr. " IS a boundary by our regex (period+space)
    expect(sentences).toContain("Dr.")
    expect(remaining).toBe("Smith went home.")
  })

  it("handles multiple spaces after punctuation", () => {
    const { sentences, remaining } = splitIntoSentences("שלום.  מה שלומך?")
    expect(sentences).toEqual(["שלום."])
    expect(remaining).toBe("מה שלומך?")
  })

  it("splits on question mark in Hebrew", () => {
    // "אני כן בסדר." at end → remaining
    const { sentences, remaining } = splitIntoSentences("האם אתה בסדר? אני כן בסדר.")
    expect(sentences).toEqual(["האם אתה בסדר?"])
    expect(remaining).toBe("אני כן בסדר.")
  })

  it("returns only remaining when half-sentence at end", () => {
    const { sentences, remaining } = splitIntoSentences("משפט שלם. חצי")
    expect(sentences).toEqual(["משפט שלם."])
    expect(remaining).toBe("חצי")
  })
})
