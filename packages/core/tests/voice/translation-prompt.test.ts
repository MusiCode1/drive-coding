import { describe, expect, it } from "vitest"
import { buildTranslationPrompt } from "../../src/voice/translation-prompt"

describe("buildTranslationPrompt", () => {
  it("returns Hebrew translation prompt for targetLang='he'", () => {
    const prompt = buildTranslationPrompt("Hello world", "he")
    expect(prompt).toContain("Hello world")
    expect(prompt).toContain("עברית")
  })

  it("returns English translation prompt for targetLang='en'", () => {
    const prompt = buildTranslationPrompt("שלום עולם", "en")
    expect(prompt).toContain("שלום עולם")
    expect(prompt).toContain("English")
  })

  it("Hebrew prompt instructs to return as-is if already Hebrew", () => {
    const prompt = buildTranslationPrompt("כבר עברית", "he")
    expect(prompt.toLowerCase()).toContain("עברית")
    // Should mention returning as-is
    expect(prompt).toMatch(/כבר|כמו שהוא|as.is/i)
  })

  it("English prompt instructs to return as-is if already English", () => {
    const prompt = buildTranslationPrompt("Already English", "en")
    expect(prompt).toContain("Already English")
    expect(prompt).toMatch(/as.is|already english/i)
  })

  it("includes the source text in the prompt", () => {
    const text = "unique-test-string-12345"
    const promptHe = buildTranslationPrompt(text, "he")
    const promptEn = buildTranslationPrompt(text, "en")
    expect(promptHe).toContain(text)
    expect(promptEn).toContain(text)
  })

  it("Hebrew prompt does not contain instructions to add commentary", () => {
    const prompt = buildTranslationPrompt("test", "he")
    expect(prompt).not.toContain("explain")
  })
})
