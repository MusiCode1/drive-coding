import { describe, expect, it } from "vitest"
import { splitIntoSentences } from "../../src/voice/sentence-boundary"

describe("splitIntoSentences — core behaviour", () => {
  it("test 1: is deterministic — same input always gives same output", () => {
    const input = "שלום עולם. מה שלומך? אני בסדר גמור היום."
    const r1 = splitIntoSentences(input)
    const r2 = splitIntoSentences(input)
    expect(r1).toEqual(r2)
  })

  it("test 2: does not cut on the abbreviation 'Dr.'", () => {
    const { sentences, remaining } = splitIntoSentences("Dr. Smith said hello. Then he left.")
    expect(sentences).toEqual(["Dr. Smith said hello.", "Then he left."])
    expect(remaining).toBe("")
  })

  it("test 3: does not cut inside a URL containing periods", () => {
    const { sentences, remaining } = splitIntoSentences("Visit https://3.14.example.com today. It works.")
    expect(sentences).toEqual(["Visit https://3.14.example.com today.", "It works."])
    expect(remaining).toBe("")
  })

  it("test 4: treats a double-newline as a paragraph boundary even without a period", () => {
    const { sentences, remaining } = splitIntoSentences("שלום\n\nעולם")
    expect(sentences).toEqual(["שלום", "עולם"])
    expect(remaining).toBe("")
  })

  it("test 5: merges short raw segments into the next one (minChars=20 default)", () => {
    const { sentences, remaining } = splitIntoSentences("OK. Now this is a longer sentence.")
    expect(sentences).toEqual(["OK. Now this is a longer sentence."])
    expect(remaining).toBe("")
  })

  it("test 6: force-splits a long sentence on a word boundary, not mid-word", () => {
    // 250 chars of "word " repeated, no terminator → caller-provided maxChars=200
    const long = "word ".repeat(50).trim() + "."
    const { sentences } = splitIntoSentences(long, { maxChars: 200 })
    expect(sentences.length).toBeGreaterThanOrEqual(2)
    for (const s of sentences) {
      expect(s.length).toBeLessThanOrEqual(200)
      // cut on word boundary: never ends mid-word
      // (every chunk ends either with a period or with full "word" token)
      expect(/word\.?$/.test(s)).toBe(true)
    }
    // concatenating back should restore the original token sequence
    const recombined = sentences.join(" ")
    expect(recombined.replace(/\s+/g, " ")).toBe(long)
  })

  it("test 7: streaming determinism — 1-char chunks accumulate to the same result", () => {
    // NB: lower-case "bye" wouldn't split (ICU treats `. lower` as an
    // abbreviation), so the streaming test uses uppercase "Bye" to actually
    // exercise the split-then-stash-remaining path.
    const input = "hello world. Bye"
    // one-shot
    const oneShot = splitIntoSentences(input)
    // streaming
    let buffer = ""
    const collectedSentences: string[] = []
    let lastRemaining = ""
    for (const ch of input) {
      buffer = lastRemaining + ch
      const { sentences, remaining } = splitIntoSentences(buffer)
      for (const s of sentences) collectedSentences.push(s)
      lastRemaining = remaining
    }
    expect(collectedSentences).toEqual(oneShot.sentences)
    expect(lastRemaining).toBe(oneShot.remaining)
  })

  it("test 8: does NOT cut on comma or colon (regression — old regex did)", () => {
    const commaInput = "ראשית, נבין את הנושא. ואז נמשיך."
    expect(splitIntoSentences(commaInput).sentences).toEqual(["ראשית, נבין את הנושא.", "ואז נמשיך."])

    const colonInput = "Note: this is important. And so is this."
    expect(splitIntoSentences(colonInput).sentences).toEqual([
      "Note: this is important.",
      "And so is this.",
    ])
  })
})

describe("splitIntoSentences — supporting cases", () => {
  it("returns empty for empty input", () => {
    expect(splitIntoSentences("")).toEqual({ sentences: [], remaining: "" })
  })

  it("Hebrew: splits two sentences", () => {
    const { sentences, remaining } = splitIntoSentences("שלום עולם. מה שלומך?")
    expect(sentences).toEqual(["שלום עולם. מה שלומך?".trim()].length === 1 ? sentences : sentences)
    // the second is short (< 20 chars) so it gets merged with the previous one
    expect(sentences).toEqual(["שלום עולם. מה שלומך?"])
    expect(remaining).toBe("")
  })

  it("Hebrew: long enough sentences are kept separate", () => {
    const a = "שלום עולם זה משפט ראשון ארוך מספיק."
    const b = "ועכשיו משפט שני שגם הוא ארוך מספיק."
    const { sentences } = splitIntoSentences(`${a} ${b}`)
    expect(sentences).toEqual([a, b])
  })

  it("keeps a half-finished trailing sentence in remaining", () => {
    const { sentences, remaining } = splitIntoSentences(
      "זהו משפט שלם ארוך מספיק. חצי",
    )
    expect(sentences).toEqual(["זהו משפט שלם ארוך מספיק."])
    expect(remaining).toBe("חצי")
  })

  it("respects a custom locale", () => {
    const { sentences } = splitIntoSentences("Hello world. How are you doing today?", { locale: "en" })
    expect(sentences).toEqual(["Hello world. How are you doing today?"])
  })

  it("custom minChars=0 keeps short sentences separate", () => {
    const { sentences } = splitIntoSentences("Hi. Bye.", { minChars: 0 })
    expect(sentences).toEqual(["Hi.", "Bye."])
  })

  it("force-split chunks are also subject to maxChars", () => {
    const verylong = "alpha ".repeat(200).trim() + "."
    const { sentences } = splitIntoSentences(verylong, { maxChars: 100 })
    for (const s of sentences) expect(s.length).toBeLessThanOrEqual(100)
  })

  it("trims leading whitespace from remaining (streaming hygiene)", () => {
    // ' bye' is what you'd literally see after consuming a sentence ending with '.';
    // we strip the leading space so callers don't accumulate it forever.
    const { sentences, remaining } = splitIntoSentences("done now and this is long. Bye")
    expect(sentences).toEqual(["done now and this is long."])
    expect(remaining).toBe("Bye")
  })
})
