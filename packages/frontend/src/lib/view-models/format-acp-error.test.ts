/**
 * format-acp-error.test.ts — TDD (Commit 0, slice surface-real-error).
 *
 * formatAcpError מחלץ את ההודעה המשמעותית ביותר משגיאת ACP client (JSON-RPC).
 * סדר עדיפויות: data.details → data.message → message → String(e).
 *
 * המקרה הקריטי (§0 בתוכנית): envelope עם message:"Internal error" + data.details
 * אמיתי (repro חי 2026-07-22) → צריך להעדיף את ה-details, לא את ה-message הגנרי.
 */

import { describe, expect, test } from "vitest"
import { formatAcpError } from "./format-acp-error"

describe("formatAcpError", () => {
  test("data.details קיים → מוחזר", () => {
    const e = { code: -32603, message: "some message", data: { details: "the real reason" } }
    expect(formatAcpError(e)).toBe("the real reason")
  })

  test("רק message (אין data) → מוחזר", () => {
    const e = { message: "plain failure" }
    expect(formatAcpError(e)).toBe("plain failure")
  })

  test("non-Error (מספר) → String(e)", () => {
    expect(formatAcpError(42)).toBe("42")
  })

  test("non-Error (undefined) → String(e)", () => {
    expect(formatAcpError(undefined)).toBe("undefined")
  })

  test('המקרה הקריטי: message="Internal error" + data.details אמיתי → מעדיף details', () => {
    const e = {
      code: -32603,
      message: "Internal error",
      data: {
        details:
          "Cannot find module '@anthropic-ai/claude-agent-sdk' from '…/dist/drive-coding.js'",
      },
    }
    expect(formatAcpError(e)).toBe(
      "Cannot find module '@anthropic-ai/claude-agent-sdk' from '…/dist/drive-coding.js'",
    )
  })

  test("data קיים אבל בלי details → נופל ל-data.message", () => {
    const e = { message: "Internal error", data: { message: "data-level message" } }
    expect(formatAcpError(e)).toBe("data-level message")
  })

  test("data.details ריק (מחרוזת ריקה) → נופל ל-message", () => {
    const e = { message: "fallback message", data: { details: "" } }
    expect(formatAcpError(e)).toBe("fallback message")
  })

  test("Error רגיל (Error instance, בלי data) → e.message", () => {
    expect(formatAcpError(new Error("plain Error"))).toBe("plain Error")
  })
})
