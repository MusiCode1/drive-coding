/**
 * session-transport.test.ts — TDD עבור resolveSessionTransport (C2).
 *
 * Testing: tdd (brief §C2)
 *
 * טבלת-אמת מלאה: query ← stored ← env ← "local" (קדימות נעולה), case-insensitive
 * אחרי trim, ערך לא-מוכר יורד לרמה הבאה (❌ לא זורק).
 *
 * ─── slice view-switch C2 (TDD) ───
 */

import { describe, expect, it } from "vitest"
import { resolveSessionTransport } from "./session-transport.js"

describe("resolveSessionTransport — קדימות", () => {
  it("ללא שום קלט -> local (ברירת-מחדל)", () => {
    expect(resolveSessionTransport({})).toBe("local")
  })

  it("query בלבד -> query מנצח", () => {
    expect(resolveSessionTransport({ query: "remote" })).toBe("remote")
  })

  it("stored בלבד -> stored מנצח", () => {
    expect(resolveSessionTransport({ stored: "remote" })).toBe("remote")
  })

  it("env בלבד -> env מנצח", () => {
    expect(resolveSessionTransport({ env: "remote" })).toBe("remote")
  })

  it("query + stored -> query מנצח", () => {
    expect(resolveSessionTransport({ query: "local", stored: "remote" })).toBe("local")
  })

  it("query + env -> query מנצח", () => {
    expect(resolveSessionTransport({ query: "remote", env: "local" })).toBe("remote")
  })

  it("stored + env -> stored מנצח", () => {
    expect(resolveSessionTransport({ stored: "remote", env: "local" })).toBe("remote")
  })

  it("query + stored + env -> query מנצח (כל השלושה)", () => {
    expect(resolveSessionTransport({ query: "local", stored: "remote", env: "remote" })).toBe(
      "local",
    )
  })
})

describe("resolveSessionTransport — נורמליזציה", () => {
  it("case-insensitive אחרי trim -> 'REMOTE' -> remote", () => {
    expect(resolveSessionTransport({ query: "REMOTE" })).toBe("remote")
  })

  it("רווחים מסביב -> נחתכים -> 'local' -> local", () => {
    expect(resolveSessionTransport({ query: "  local  " })).toBe("local")
  })

  it("Mixed case + רווחים -> ' ReMoTe ' -> remote", () => {
    expect(resolveSessionTransport({ stored: " ReMoTe " })).toBe("remote")
  })
})

describe("resolveSessionTransport — ערכים לא-תקינים ✅ לא זורק, יורד לרמה הבאה", () => {
  it("query זבל, stored תקין -> יורד ל-stored", () => {
    expect(resolveSessionTransport({ query: "garbage", stored: "remote" })).toBe("remote")
  })

  it("query ריק (''), stored תקין -> יורד ל-stored", () => {
    expect(resolveSessionTransport({ query: "", stored: "remote" })).toBe("remote")
  })

  it("query null מפורש, env תקין -> יורד ל-env", () => {
    expect(resolveSessionTransport({ query: null, env: "remote" })).toBe("remote")
  })

  it("כל השלושה זבל -> local (ברירת-מחדל)", () => {
    expect(resolveSessionTransport({ query: "xyz", stored: "abc", env: "def" })).toBe("local")
  })

  it("env undefined מפורש -> local", () => {
    expect(resolveSessionTransport({ env: undefined })).toBe("local")
  })

  it("אינו זורק לעולם על קלט לא-צפוי", () => {
    expect(() => resolveSessionTransport({ query: "🔥", stored: "💥" })).not.toThrow()
  })
})
