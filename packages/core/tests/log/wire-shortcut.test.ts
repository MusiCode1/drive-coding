/**
 * wire-shortcut.test.ts — `LOG_WIRE` חייב **להוסיף** מעקב-חוט, לא להחליף לוגים.
 *
 * 🔴 הבאג שהוליד את הטסט (2026-08-16): הקיצור עשה
 *   `config.ns = config.ns === "*" ? "backend.acp.wire.*" : …`
 * ⇒ כל שאר ה-namespaces של ה-BE כובו בשקט. הרצנו כך שעות, וכשל-spawn אמיתי
 * לא הותיר ולו שורה אחת שתסביר אותו — מה שהפך חקירה של דקות לחקירה של שעה.
 * קיצור-דרך שנועד להוסיף נראוּת הסיר אותה.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseEnvConfig } from "../../src/log/config.js"

const KEYS = ["LOG_WIRE", "LOG_NS", "LOG_LEVEL", "LOG_FORMAT"] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("LOG_WIRE — קיצור-דרך מוסיף ולא דורס", () => {
  it("🔴 LOG_WIRE=acp משאיר את ns על '*' — שאר ה-BE ממשיך להירשם", () => {
    process.env.LOG_WIRE = "acp"
    const cfg = parseEnvConfig()
    expect(cfg.ns).toBe("*") // ← לפני התיקון היה "backend.acp.wire.*"
    expect(cfg.traceNs).toBe("backend.acp.wire.*")
  })

  it("LOG_WIRE אינו מציף: ה-level הגלובלי נשאר ברירת-המחדל", () => {
    process.env.LOG_WIRE = "acp"
    // לפני התיקון זה נדרס ל-"trace", וכל ה-BE הציף. מעקב-החוט מגיע מ-traceNs,
    // שעוקף את בדיקת-הרמה רק עבור מרחבי-החוט עצמם.
    expect(parseEnvConfig().level).toBe("info")
  })

  it("LOG_NS מפורש נשמר לצד מעקב-החוט", () => {
    process.env.LOG_WIRE = "acp"
    process.env.LOG_NS = "backend.session-host.*"
    const cfg = parseEnvConfig()
    expect(cfg.ns).toBe("backend.session-host.*")
    expect(cfg.traceNs).toBe("backend.acp.wire.*")
  })

  it("LOG_WIRE=1 מכסה את שני מרחבי-החוט", () => {
    process.env.LOG_WIRE = "1"
    expect(parseEnvConfig().traceNs).toBe("backend.acp.wire.*,backend.ws.wire.*")
  })

  it("בלי LOG_WIRE — אין traceNs כלל", () => {
    expect(parseEnvConfig().traceNs).toBeUndefined()
  })
})
