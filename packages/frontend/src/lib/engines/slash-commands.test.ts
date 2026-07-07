/**
 * slash-commands.test.ts — TDD עבור matchSlashCommands() + applySlashSelection() טהור
 * (slice-slash-commands, Commit 1).
 *
 * מכסה (§4 Commit 1 / §5 DoD):
 *   - "" → null; "hi" → null (לא מתחיל ב-"/")
 *   - "/" → כל הפקודות, query=""
 *   - "/co" → prefix-match case-insensitive על name
 *   - "/commit " (רווח אחרי token) → null (מצב-ארגומנטים)
 *   - case-insensitive: "/svelte" תואם "Svelte-MCP"
 *   - "/zzz" → { query: "zzz", matches: [] } (לא null)
 *   - applySlashSelection({name:"commit",...}) → "/commit "
 *
 * Testing: TDD (red→green)
 */

import type { AvailableCommand } from "@agentclientprotocol/sdk"
import { describe, expect, it } from "vitest"
import { applySlashSelection, matchSlashCommands } from "./slash-commands"

const COMMANDS: AvailableCommand[] = [
  { name: "commit", description: "Create a git commit" },
  { name: "code-review", description: "Review the current diff" },
  { name: "find-docs", description: "Find relevant docs" },
  { name: "Svelte-MCP", description: "Svelte MCP tool" },
]

describe("matchSlashCommands", () => {
  it('מחזיר null עבור מחרוזת ריקה ("")', () => {
    expect(matchSlashCommands("", COMMANDS)).toBeNull()
  })

  it('מחזיר null עבור טקסט שלא מתחיל ב-"/"', () => {
    expect(matchSlashCommands("hi", COMMANDS)).toBeNull()
  })

  it('מחזיר את כל הפקודות עבור "/" בלבד, query=""', () => {
    const result = matchSlashCommands("/", COMMANDS)
    expect(result).not.toBeNull()
    expect(result?.query).toBe("")
    expect(result?.matches).toEqual(COMMANDS)
  })

  it('מסנן prefix-match case-insensitive על name עבור "/co"', () => {
    const result = matchSlashCommands("/co", COMMANDS)
    expect(result).not.toBeNull()
    expect(result?.query).toBe("co")
    expect(result?.matches.map((c) => c.name)).toEqual(["commit", "code-review"])
  })

  it('מחזיר null כשיש רווח אחרי ה-token (מצב-ארגומנטים) — "/commit "', () => {
    expect(matchSlashCommands("/commit ", COMMANDS)).toBeNull()
  })

  it('case-insensitive: "/svelte" תואם "Svelte-MCP"', () => {
    const result = matchSlashCommands("/svelte", COMMANDS)
    expect(result).not.toBeNull()
    expect(result?.matches.map((c) => c.name)).toEqual(["Svelte-MCP"])
  })

  it('מחזיר { query, matches: [] } (לא null) עבור "/zzz" ללא תוצאות', () => {
    const result = matchSlashCommands("/zzz", COMMANDS)
    expect(result).toEqual({ query: "zzz", matches: [] })
  })

  it("query עם ארגומנטים חלקיים באמצע הקלדה (בלי רווח) עדיין תואם", () => {
    const result = matchSlashCommands("/find", COMMANDS)
    expect(result).not.toBeNull()
    expect(result?.matches.map((c) => c.name)).toEqual(["find-docs"])
  })

  it("רשימת פקודות ריקה → matches ריק, לא null", () => {
    const result = matchSlashCommands("/co", [])
    expect(result).toEqual({ query: "co", matches: [] })
  })
})

describe("applySlashSelection", () => {
  it('מחזיר "/<name> " (עם רווח נגרר) עבור פקודה נבחרת', () => {
    const cmd: AvailableCommand = { name: "commit", description: "Create a git commit" }
    expect(applySlashSelection(cmd)).toBe("/commit ")
  })
})
