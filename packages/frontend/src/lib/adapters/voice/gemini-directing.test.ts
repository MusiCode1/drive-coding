/**
 * gemini-directing.test.ts — TDD עבור buildGeminiDirecting (Commit 1).
 *
 * מכסה DoD#3: ברירת-מחדל (normal+neutral/undefined) → req.text כמות שהוא;
 * directing פעיל → פורמט הרשמי (# Director's note / ## Transcript:); שדה בודד
 * כשרק אחד לא-ברירת-מחדל; שילובי pace/tone.
 */
import { describe, expect, it } from "vitest"
import { buildGeminiDirecting } from "./gemini-directing"

describe("buildGeminiDirecting", () => {
  it("ללא directing → מחזיר req.text כמות שהוא (אפס עטיפה)", () => {
    const result = buildGeminiDirecting({ text: "שלום, מה שלומך?" })
    expect(result).toBe("שלום, מה שלומך?")
  })

  it("directing={} (שני השדות undefined) → מחזיר req.text כמות שהוא", () => {
    const result = buildGeminiDirecting({ text: "hello", directing: {} })
    expect(result).toBe("hello")
  })

  it("pace=normal + tone=neutral (ברירת-מחדל מפורשת) → מחזיר req.text כמות שהוא", () => {
    const result = buildGeminiDirecting({
      text: "hello",
      directing: { pace: "normal", tone: "neutral" },
    })
    expect(result).toBe("hello")
  })

  it("pace=very-slow בלבד → שדה Pace בודד", () => {
    const result = buildGeminiDirecting({
      text: "hello world",
      directing: { pace: "very-slow" },
    })
    expect(result).toBe(
      "Read the following transcript based on the director's note.\n\n" +
        "# Director's note\n" +
        "Pace: Very Slow.\n\n" +
        "## Transcript:\n" +
        "hello world",
    )
  })

  it("tone=calm בלבד → שדה Style בודד", () => {
    const result = buildGeminiDirecting({
      text: "hello world",
      directing: { tone: "calm" },
    })
    expect(result).toBe(
      "Read the following transcript based on the director's note.\n\n" +
        "# Director's note\n" +
        "Style: Calm.\n\n" +
        "## Transcript:\n" +
        "hello world",
    )
  })

  it("tone=energetic + pace=fast → Style ואז Pace באותה שורה", () => {
    const result = buildGeminiDirecting({
      text: "hello world",
      directing: { pace: "fast", tone: "energetic" },
    })
    expect(result).toBe(
      "Read the following transcript based on the director's note.\n\n" +
        "# Director's note\n" +
        "Style: Energetic. Pace: Fast.\n\n" +
        "## Transcript:\n" +
        "hello world",
    )
  })

  it("תמיד מכיל את req.text המדויק בגוף ה-Transcript", () => {
    const text = "some transcript text with special chars: !@#"
    const result = buildGeminiDirecting({ text, directing: { pace: "slow" } })
    expect(result.endsWith(text)).toBe(true)
    expect(result).toContain(`## Transcript:\n${text}`)
  })

  // ─── מיפוי pace מלא ───
  it.each([
    ["very-slow", "Very Slow"],
    ["slow", "Slow"],
    ["fast", "Fast"],
    ["very-fast", "Rapid Fire"],
  ] as const)("pace=%s → Pace: %s", (pace, label) => {
    const result = buildGeminiDirecting({ text: "x", directing: { pace } })
    expect(result).toContain(`Pace: ${label}.`)
  })

  // ─── מיפוי tone מלא ───
  it.each([
    ["calm", "Calm"],
    ["energetic", "Energetic"],
    ["formal", "Professional"],
    ["casual", "Conversational"],
  ] as const)("tone=%s → Style: %s", (tone, label) => {
    const result = buildGeminiDirecting({ text: "x", directing: { tone } })
    expect(result).toContain(`Style: ${label}.`)
  })

  it("pace=normal (ברירת-מחדל) + tone=energetic → רק Style, אין Pace", () => {
    const result = buildGeminiDirecting({
      text: "x",
      directing: { pace: "normal", tone: "energetic" },
    })
    expect(result).toContain("# Director's note\nStyle: Energetic.\n\n")
    expect(result).not.toContain("Pace:")
  })

  it("pace=very-fast + tone=neutral (ברירת-מחדל) → רק Pace, אין Style", () => {
    const result = buildGeminiDirecting({
      text: "x",
      directing: { pace: "very-fast", tone: "neutral" },
    })
    expect(result).toContain("# Director's note\nPace: Rapid Fire.\n\n")
    expect(result).not.toContain("Style:")
  })
})
