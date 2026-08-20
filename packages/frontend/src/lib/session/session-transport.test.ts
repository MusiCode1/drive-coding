/**
 * session-transport.test.ts — TDD עבור resolveSessionTransport + normalizeSessionTransport.
 *
 * Testing: tdd (brief §C1)
 *
 * טבלת-אמת מלאה: query ← override ← stored ← env ← "ws" (קדימות נעולה),
 * case-insensitive אחרי trim, ערך לא-מוכר יורד לרמה הבאה (❌ לא זורק).
 * נרדפים מיושנים: local→ws · remote→http.
 *
 * ─── slice view-switch C2 (TDD) · slice transport-polish C1 ───
 */

import { describe, expect, it } from "vitest"
import { normalizeSessionTransport, resolveSessionTransport } from "./session-transport.js"

describe("normalizeSessionTransport", () => {
  it("ws → ws", () => {
    expect(normalizeSessionTransport("ws")).toBe("ws")
  })
  it("http → http", () => {
    expect(normalizeSessionTransport("http")).toBe("http")
  })
  it("null → null", () => {
    expect(normalizeSessionTransport(null)).toBeNull()
  })
  it("undefined → null", () => {
    expect(normalizeSessionTransport(undefined)).toBeNull()
  })
  it("ערך פסול → null", () => {
    expect(normalizeSessionTransport("banana")).toBeNull()
  })
  it("case-insensitive אחרי trim → ' HTTP ' → http", () => {
    expect(normalizeSessionTransport(" HTTP ")).toBe("http")
  })
})

describe("resolveSessionTransport — קדימות", () => {
  it("ללא שום קלט -> ws (ברירת-מחדל)", () => {
    expect(resolveSessionTransport({})).toBe("ws")
  })

  it("query בלבד -> query מנצח", () => {
    expect(resolveSessionTransport({ query: "http" })).toBe("http")
  })

  it("override בלבד -> override מנצח", () => {
    expect(resolveSessionTransport({ override: "http" })).toBe("http")
  })

  it("stored בלבד -> stored מנצח", () => {
    expect(resolveSessionTransport({ stored: "http" })).toBe("http")
  })

  it("env בלבד -> env מנצח", () => {
    expect(resolveSessionTransport({ env: "http" })).toBe("http")
  })

  it("query + override -> query מנצח", () => {
    expect(resolveSessionTransport({ query: "ws", override: "http" })).toBe("ws")
  })

  it("query + stored -> query מנצח", () => {
    expect(resolveSessionTransport({ query: "ws", stored: "http" })).toBe("ws")
  })

  it("query + env -> query מנצח", () => {
    expect(resolveSessionTransport({ query: "http", env: "ws" })).toBe("http")
  })

  it("override + stored -> override מנצח", () => {
    expect(resolveSessionTransport({ override: "http", stored: "ws" })).toBe("http")
  })

  it("override + env -> override מנצח", () => {
    expect(resolveSessionTransport({ override: "http", env: "ws" })).toBe("http")
  })

  it("stored + env -> stored מנצח", () => {
    expect(resolveSessionTransport({ stored: "http", env: "ws" })).toBe("http")
  })

  it("query + override + stored + env -> query מנצח (כל הארבעה)", () => {
    expect(
      resolveSessionTransport({ query: "ws", override: "http", stored: "http", env: "http" }),
    ).toBe("ws")
  })
})

describe("resolveSessionTransport — נורמליזציה", () => {
  it("case-insensitive אחרי trim -> 'HTTP' -> http", () => {
    expect(resolveSessionTransport({ query: "HTTP" })).toBe("http")
  })

  it("רווחים מסביב -> נחתכים -> 'ws' -> ws", () => {
    expect(resolveSessionTransport({ query: "  ws  " })).toBe("ws")
  })

  it("Mixed case + רווחים -> ' Ws ' -> ws", () => {
    expect(resolveSessionTransport({ stored: " Ws " })).toBe("ws")
  })
})

describe("resolveSessionTransport — נרדפים מיושנים (local/remote)", () => {
  it("local → ws", () => {
    expect(resolveSessionTransport({ query: "local" })).toBe("ws")
  })
  it("remote → http", () => {
    expect(resolveSessionTransport({ query: "remote" })).toBe("http")
  })
  it("LOCAL (case) → ws", () => {
    expect(resolveSessionTransport({ stored: "LOCAL" })).toBe("ws")
  })
  it("remote ב-override → http", () => {
    expect(resolveSessionTransport({ override: "remote" })).toBe("http")
  })
})

describe("resolveSessionTransport — ערכים לא-תקינים ✅ לא זורק, יורד לרמה הבאה", () => {
  it("query זבל, stored תקין -> יורד ל-stored", () => {
    expect(resolveSessionTransport({ query: "garbage", stored: "http" })).toBe("http")
  })

  it("query ריק (''), stored תקין -> יורד ל-stored", () => {
    expect(resolveSessionTransport({ query: "", stored: "http" })).toBe("http")
  })

  it("query null מפורש, env תקין -> יורד ל-env", () => {
    expect(resolveSessionTransport({ query: null, env: "http" })).toBe("http")
  })

  it("כל הארבעה זבל -> ws (ברירת-מחדל)", () => {
    expect(
      resolveSessionTransport({ query: "xyz", override: "abc", stored: "def", env: "ghi" }),
    ).toBe("ws")
  })

  it("env undefined מפורש -> ws", () => {
    expect(resolveSessionTransport({ env: undefined })).toBe("ws")
  })

  it("אינו זורק לעולם על קלט לא-צפוי", () => {
    expect(() => resolveSessionTransport({ query: "🔥", stored: "💥" })).not.toThrow()
  })
})

describe("resolveSessionTransport — קדימות override מול stored (transport-polish §3)", () => {
  it("עקיבה (override=sessionStorage) גוברת על העדפה (stored=localStorage)", () => {
    expect(resolveSessionTransport({ override: "http", stored: "ws" })).toBe("http")
  })

  it("העדפה (stored) גוברת על env כשאין override", () => {
    expect(resolveSessionTransport({ stored: "http", env: "ws" })).toBe("http")
  })
})
