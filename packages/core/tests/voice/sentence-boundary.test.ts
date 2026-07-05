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

  it("test 4: multi-para requires completed paragraphs (\\n\\n after them); trailing last-para is held in remaining", () => {
    // before fix: sentences=["שלום","עולם"], remaining=""
    // after fix: הפסקה האחרונה ("עולם") עדיין בזרימה → מוחזקת כ-remaining
    const { sentences, remaining } = splitIntoSentences("שלום\n\nעולם")
    expect(sentences).toEqual(["שלום"])
    expect(remaining).toBe("עולם")
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

describe("splitIntoSentences — streaming mid-word safety (commit 0: fix A)", () => {
  it("streaming: a chunk ending mid-word in a multi-paragraph buffer does NOT emit a mid-word segment", () => {
    // chunk#1 ends mid-word ("### מ") while the buffer already contains a \n\n
    const c1 =
      "טקסט קודם ארוך מספיק כדי להיחשב.\n\n### מ"
    const c2 =
      "ה נשאר פתוח (לא חוסם)\n- פריט"
    let buf = ""
    const emitted: string[] = []
    for (const ch of [c1, c2]) {
      const { sentences, remaining } = splitIntoSentences(buf + ch)
      for (const s of sentences) emitted.push(s)
      buf = remaining
    }
    // no segment should end with the half-word "### מ" (U+05DE alone)
    expect(emitted.join(" | ")).not.toMatch(/### מ$/)
    // the complete word "מה" (U+05DE U+05D4) should appear in some emitted segment
    expect(emitted.some((s) => s.includes("### מה"))).toBe(true)
  })

  it("streaming: single-para buffer — trailing unfinished segment is still held in remaining (regression guard)", () => {
    // single paragraph, no \n\n → remaining-hold already worked before fix A
    const buf = "טקסט קודם ארוך מספיק כדי להיחשב. חצי"
    const { sentences, remaining } = splitIntoSentences(buf)
    // the complete first sentence is emitted
    expect(sentences.length).toBeGreaterThanOrEqual(1)
    // the half-word is NOT emitted, it stays in remaining
    expect(sentences.join(" ")).not.toMatch(/חצי$/)
    expect(remaining).toMatch(/חצי/)
  })

  it("streaming: real-world fixtures — words from actual recordings are NOT split mid-word", () => {
    // Three of the 7 words that were cut mid-word in the live recordings:
    // "הודעת" (=הודעת), "בוצע" (=בוצע), "השינויים" (=השינויים)
    const words = ["הודעת", "בוצע", "השינויים"]
    for (const word of words) {
      // Simulate: buffer has completed paragraph + \n\n, then second para starts mid-word
      const half = word.slice(0, Math.ceil(word.length / 2))
      const rest = word.slice(Math.ceil(word.length / 2))
      const c1 = "פסקה ראשונה ארוכה מספיק. תוכן.\n\n" + half
      const c2 = rest + " ועוד תוכן נוסף."
      let buf = ""
      const emitted: string[] = []
      for (const ch of [c1, c2]) {
        const { sentences, remaining } = splitIntoSentences(buf + ch)
        for (const s of sentences) emitted.push(s)
        buf = remaining
      }
      const combined = emitted.join(" ") + " " + buf
      // the whole word should appear somewhere — not split across segments
      expect(combined).toContain(word)
      // no emitted segment ends with the partial first half alone
      expect(emitted.some((s) => s.trimEnd().endsWith(half))).toBe(false)
    }
  })
})

describe("splitIntoSentences — bidi normalization (commit 1: fix B)", () => {
  // Use \u-escapes for bidi chars to avoid lint:i18n issues and for clarity.
  // U+200F = RLM (Right-to-Left Mark), U+200E = LRM (Left-to-Right Mark)
  // U+202B = Right-to-Left Embedding, U+202C = Pop Directional Formatting
  // U+2066 = Left-to-Right Isolate, U+2069 = Pop Directional Isolate
  const RLM = "‏"
  const LRM = "‎"

  it("bidi-1: RLM after terminator does not block sentence emission", () => {
    // Without normalization, RLM after "." breaks TERMINATOR_RE → sentence held in remaining
    const input = "משפט ראשון ארוך מספיק להיפלט." + RLM
    const { sentences, remaining } = splitIntoSentences(input)
    expect(sentences).toEqual(["משפט ראשון ארוך מספיק להיפלט."])
    expect(remaining).toBe("")
  })

  it("bidi-2: RLM followed by space after terminator does not block emission", () => {
    const input = "משפט ראשון ארוך מספיק להיפלט." + RLM + " "
    const { sentences, remaining } = splitIntoSentences(input)
    expect(sentences.length).toBeGreaterThanOrEqual(1)
    expect(remaining).toBe("")
  })

  it("bidi-3: control — same sentence without RLM is emitted (no regression)", () => {
    const input = "משפט ראשון ארוך מספיק להיפלט."
    const { sentences, remaining } = splitIntoSentences(input)
    expect(sentences).toEqual(["משפט ראשון ארוך מספיק להיפלט."])
    expect(remaining).toBe("")
  })

  it("bidi-4: RLM at start of continuation chunk does NOT appear at start of emitted segment", () => {
    // Streaming: first chunk emits a sentence, second chunk starts with RLM
    const c1 = "משפט ראשון ארוך מספיק להיפלט."
    const c2 = RLM + "משפט שני ארוך מספיק כאן."
    let buf = ""
    const emitted: string[] = []
    for (const ch of [c1, c2]) {
      const { sentences, remaining } = splitIntoSentences(buf + ch)
      for (const s of sentences) emitted.push(s)
      buf = remaining
    }
    // No segment should start with a bidi character
    for (const seg of emitted) {
      expect(seg.startsWith(RLM)).toBe(false)
      expect(seg.startsWith(LRM)).toBe(false)
    }
  })

  it("bidi-5: Hebrew vowel diacritics (niqqud) are NOT stripped — preserved in output", () => {
    // Niqqud (U+05B0-U+05C7) must NOT be removed — they help pronunciation
    const input = "שְלוֹם עוֹלָם. משִפט שֵני ארוך מספיק כאן."
    // = "שְׁלוֹם עוֹלָם. משפט שני ארוך מספיק כאן." (with niqqud on first word)
    const { sentences } = splitIntoSentences(input)
    // should split into 2 sentences (or merge if first is short)
    expect(sentences.length).toBeGreaterThanOrEqual(1)
    // niqqud chars must be present in the output
    expect(sentences.join("")).toMatch(/[ְ-ׇ]/)
  })

  it("bidi-6: heavy RLM inflation — segments count and size match clean version", () => {
    // A long sentence with RLM after every space — should not inflate segment count
    const base = "מילה ".repeat(45).trim() + "."
    const withRlm = base.replace(/ /g, " " + RLM)
    const cleanResult = splitIntoSentences(base)
    const rlmResult = splitIntoSentences(withRlm)
    // same number of segments
    expect(rlmResult.sentences.length).toBe(cleanResult.sentences.length)
    // all segments within maxChars=200
    for (const s of rlmResult.sentences) {
      expect(s.length).toBeLessThanOrEqual(200)
    }
  })

  it("bidi-7: bilingual text with LRM/RLM around latin — splits correctly, no bidi in output", () => {
    // "...‎npm run build‏ עובד. משפט הבא ארוך מספיק כאן."
    const input = "פרויקט הרצה עם " + LRM + "npm run build" + RLM + " עובד. משפט הבא ארוך מספיק כאן."
    const { sentences, remaining } = splitIntoSentences(input)
    // at least one sentence emitted (possibly merged if first is short)
    expect(sentences.length).toBeGreaterThanOrEqual(1)
    // no bidi chars in any emitted segment
    const bidiRe = /[‎‏‪-‮⁦-⁩]/
    for (const s of sentences) {
      expect(bidiRe.test(s)).toBe(false)
    }
    expect(bidiRe.test(remaining)).toBe(false)
  })
})

describe("force-split floor", () => {
  const minChars = 20
  const maxChars = 200

  it("test 1: orphan tail is absorbed — no chunk below minChars", () => {
    // "מילה ".repeat(n) builds a long prefix, then a short trailing word ("סוף.")
    // that force-split would otherwise emit as its own tiny tail chunk.
    const long = "מילה ".repeat(40).trim() + " סוף."
    const { sentences } = splitIntoSentences(long, { maxChars, minChars })
    for (const s of sentences) expect(s.length).toBeGreaterThanOrEqual(minChars)
  })

  it("test 2: a healthy tail (>= minChars) is NOT merged (regression guard)", () => {
    // Build a sentence whose force-split tail chunk is comfortably >= minChars,
    // so the floor-pass must leave the chunk boundaries alone.
    const long = "word ".repeat(60).trim() + "."
    const before = splitIntoSentences(long, { maxChars: 200, minChars: 0 }).sentences
    const after = splitIntoSentences(long, { maxChars: 200, minChars }).sentences
    // no merging should occur: same chunk boundaries as the minChars=0 baseline
    expect(after).toEqual(before)
  })

  it("test 3: merge-overflow bound — merged chunk <= maxChars + 2*minChars (double-absorption)", () => {
    // Configuration [short prefix, giant word, short tail] forces the giant word's
    // chunk to absorb BOTH neighbors (double-absorption), the true worst case.
    const prefix = "אב" // 2 chars — well below minChars
    const giant = "x".repeat(199) // just under maxChars alone, but combined with prefix > maxChars
    const tail = "סוף" // 3 chars — well below minChars
    const input = `${prefix} ${giant} ${tail}.`
    const { sentences } = splitIntoSentences(input, { maxChars, minChars })
    for (const s of sentences) {
      expect(s.length).toBeLessThanOrEqual(maxChars + 2 * minChars)
      expect(s.length).toBeGreaterThanOrEqual(minChars)
    }
  })

  it("test 4: a single word longer than maxChars — single chunk, no crash, no merge", () => {
    const input = "x".repeat(250) + "."
    const { sentences } = splitIntoSentences(input, { maxChars, minChars })
    expect(sentences.length).toBe(1)
    expect(sentences[0]?.length).toBeGreaterThan(maxChars)
  })

  it("test 5: orphan tail that is NOT last is absorbed (finding 2 — non-last sub-floor chunk)", () => {
    // A short prefix followed by a word so long it alone forces the prefix into
    // its own sub-floor chunk (not the last chunk in the force-split output),
    // followed by more normal content. The naive "fix only the last chunk"
    // approach fails this test; the backward floor-pass must catch it too.
    const prefix = "אב"
    const giant = "x".repeat(199)
    const input = `${prefix} ${giant} המשך ארוך תקין כדי לא ליצור עוד זנב קצר כאן בסוף המשפט הזה.`
    const { sentences } = splitIntoSentences(input, { maxChars, minChars })
    for (const s of sentences) expect(s.length).toBeGreaterThanOrEqual(minChars)
  })

  it("test 6: 3+ chunks, only the trailing orphan merges — middle chunks stay intact", () => {
    // A long run of "word " content (multiple full maxChars-sized chunks) followed
    // by a short trailing word. Only the tail should merge; earlier full chunks
    // (well above minChars) must remain untouched.
    const long = "word ".repeat(120).trim() + " סוף."
    const { sentences } = splitIntoSentences(long, { maxChars, minChars })
    expect(sentences.length).toBeGreaterThanOrEqual(3)
    for (const s of sentences) expect(s.length).toBeGreaterThanOrEqual(minChars)
    // the very last emitted chunk must not be the standalone short tail
    expect(sentences[sentences.length - 1]).not.toBe("סוף.")
  })

  it("test 7: live fixture — the sentence that was caught live does not end in a standalone tail", () => {
    // ~201 chars — long enough to force-split, with the trailing word "ביניהם."
    // ending up as an orphan tail chunk before the floor-pass fix (the exact
    // shape of the sentence caught live on 2026-07-05).
    const input =
      "מסקנה: הבנו את מלוא ההשלכות של השינוי הזה על כל שאר חלקי המערכת ולוודא שהצלחנו להבין לחלוטין ובאופן מלא ומדויק ביותר את מלוא אופיים המדויק של הקשרים ההדדיים ואת מכלול הכללים והחוקיות של המעברים ביניהם."
    expect(input.length).toBeGreaterThan(maxChars)
    const { sentences } = splitIntoSentences(input, { maxChars, minChars })
    expect(sentences).not.toContain("ביניהם.")
    for (const s of sentences) expect(s.length).toBeGreaterThanOrEqual(minChars)
  })

  it("test 8: minChars=0 disables the floor (regression guard — consistent with existing custom minChars=0 test)", () => {
    const long = "מילה ".repeat(40).trim() + " סוף."
    const withFloor = splitIntoSentences(long, { maxChars, minChars: 20 }).sentences
    const withoutFloor = splitIntoSentences(long, { maxChars, minChars: 0 }).sentences
    // disabling the floor must not error and may leave a short tail
    expect(Array.isArray(withoutFloor)).toBe(true)
    // sanity: the floor-enabled version should have fewer or equal chunks (merge only shrinks count)
    expect(withFloor.length).toBeLessThanOrEqual(withoutFloor.length)
  })

  it("test 9: determinism — same input always yields the same output", () => {
    const input = "מילה ".repeat(40).trim() + " סוף."
    const r1 = splitIntoSentences(input, { maxChars, minChars })
    const r2 = splitIntoSentences(input, { maxChars, minChars })
    expect(r1).toEqual(r2)
  })

  it("test 10: existing maxChars tests remain green unchanged (no orphan tail in their inputs)", () => {
    // test 6 fixture from the top describe block
    const long = "word ".repeat(50).trim() + "."
    const { sentences: s1 } = splitIntoSentences(long, { maxChars: 200 })
    expect(s1.length).toBeGreaterThanOrEqual(2)
    for (const s of s1) {
      expect(s.length).toBeLessThanOrEqual(200)
      expect(/word\.?$/.test(s)).toBe(true)
    }

    // "force-split chunks are also subject to maxChars" fixture
    const verylong = "alpha ".repeat(200).trim() + "."
    const { sentences: s2 } = splitIntoSentences(verylong, { maxChars: 100 })
    for (const s of s2) expect(s.length).toBeLessThanOrEqual(100)
  })
})
