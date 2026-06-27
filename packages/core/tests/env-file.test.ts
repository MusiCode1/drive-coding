/**
 * env-file.test.ts — TDD for parseEnvFile.
 *
 * Covers:
 *  1. basic KEY=VALUE
 *  2. # comment lines skipped
 *  3. empty lines skipped
 *  4. value with = inside (split on first = only)
 *  5. double-quoted value — quotes stripped
 *  6. single-quoted value — quotes stripped
 *  7. key with surrounding spaces — trimmed
 *  8. line without = — skipped
 *  9. mixed: comments + empty + values
 * 10. value with leading/trailing whitespace inside quotes
 * 11. empty file
 * 12. value without quotes is trimmed
 */

import { describe, expect, it } from "vitest"
import { parseEnvFile } from "../src/config/env-file.js"

describe("parseEnvFile", () => {
  it("1. basic KEY=VALUE", () => {
    const result = parseEnvFile("FOO=bar")
    expect(result).toEqual({ FOO: "bar" })
  })

  it("2. # comment lines skipped", () => {
    const result = parseEnvFile("# this is a comment\nFOO=bar")
    expect(result).toEqual({ FOO: "bar" })
    expect(result).not.toHaveProperty("#")
  })

  it("3. empty lines skipped", () => {
    const result = parseEnvFile("FOO=bar\n\nBAZ=qux\n")
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" })
  })

  it("4. value with = inside — split on first = only", () => {
    const result = parseEnvFile("URL=https://example.com/path?a=b&c=d")
    expect(result).toEqual({ URL: "https://example.com/path?a=b&c=d" })
  })

  it("5. double-quoted value — quotes stripped", () => {
    const result = parseEnvFile('SECRET="my secret value"')
    expect(result).toEqual({ SECRET: "my secret value" })
  })

  it("6. single-quoted value — quotes stripped", () => {
    const result = parseEnvFile("SECRET='my secret value'")
    expect(result).toEqual({ SECRET: "my secret value" })
  })

  it("7. key with surrounding spaces — trimmed", () => {
    const result = parseEnvFile("  MY_KEY =somevalue")
    expect(result).toHaveProperty("MY_KEY")
    expect(result["MY_KEY"]).toBe("somevalue")
  })

  it("8. line without = — skipped", () => {
    const result = parseEnvFile("INVALIDLINE\nFOO=bar")
    expect(result).toEqual({ FOO: "bar" })
    expect(result).not.toHaveProperty("INVALIDLINE")
  })

  it("9. mixed: comments + empty + values", () => {
    const input = [
      "# comment",
      "",
      "ELEVENLABS_API_KEY=abc123",
      "# another comment",
      "",
      "GEMINI_API_KEY=xyz789",
    ].join("\n")
    const result = parseEnvFile(input)
    expect(result).toEqual({
      ELEVENLABS_API_KEY: "abc123",
      GEMINI_API_KEY: "xyz789",
    })
  })

  it("10. value inside quotes preserves inner content verbatim", () => {
    const result = parseEnvFile('KEY="value with spaces"')
    expect(result["KEY"]).toBe("value with spaces")
  })

  it("11. empty file", () => {
    const result = parseEnvFile("")
    expect(result).toEqual({})
  })

  it("12. unquoted value is trimmed of surrounding whitespace", () => {
    const result = parseEnvFile("KEY=  hello  ")
    expect(result["KEY"]).toBe("hello")
  })

  it("13. Windows CRLF line endings handled", () => {
    const result = parseEnvFile("FOO=bar\r\nBAZ=qux\r\n")
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" })
  })
})
