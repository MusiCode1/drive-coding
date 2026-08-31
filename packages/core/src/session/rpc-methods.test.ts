/**
 * rpc-methods.test.ts — ‏slice acp-method-names.
 *
 * הטסטים כאן מכוונים לשני דברים בלבד: שהשמות הקנוניים **באמת** קנוניים
 * (מול הסכימה של ה-SDK, לא מול הזיכרון), ושחלון-המעבר באמת מקבל את שתי
 * הצורות. כל השאר הוא נתונים.
 */

import { describe, expect, it } from "vitest"
import { canonicalRpcMethod, LEGACY_RPC_METHODS, RPC_METHODS } from "./rpc-methods.js"

describe("RPC_METHODS", () => {
  it("maps the eight canonical methods to their ACP names", () => {
    expect(RPC_METHODS.prompt).toBe("session/prompt")
    expect(RPC_METHODS.cancel).toBe("session/cancel")
    expect(RPC_METHODS.setMode).toBe("session/set_mode")
    expect(RPC_METHODS.setConfigOption).toBe("session/set_config_option")
    expect(RPC_METHODS.loadSession).toBe("session/load")
    expect(RPC_METHODS.newSession).toBe("session/new")
    expect(RPC_METHODS.listSessions).toBe("session/list")
    expect(RPC_METHODS.deleteSession).toBe("session/delete")
  })

  // ⚠️ זה לא "טסט של קבועים". הטענה הנבדקת היא **שאין מקבילה קנונית**, ולכן
  // התחילית `_` — הקונבנציה של ACP להרחבה תלוית-מימוש. אם מישהו יעתיק
  // את התבנית ויכתוב `_drive/prompt`, הטסט הבא הוא שיתפוס אותו.
  it("marks the two non-canonical methods with the ACP extension prefix", () => {
    expect(RPC_METHODS.extMethod).toBe("_drive/ext")
    expect(RPC_METHODS.setSessionModel).toBe("_drive/set_session_model")
  })

  it("no canonical name is smuggled in under the extension prefix", () => {
    for (const [key, name] of Object.entries(RPC_METHODS)) {
      const isExtension = name.startsWith("_")
      const isOurs = key === "extMethod" || key === "setSessionModel"
      expect(isExtension).toBe(isOurs)
    }
  })

  it("every method name is unique", () => {
    const names = Object.values(RPC_METHODS)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("canonicalRpcMethod — the transition window", () => {
  // 🔴 הטסט המרכזי. טאב שנפתח לפני הפריסה ממשיך לשלוח את השם הישן; בלי
  // ההקבלה הזו הוא מקבל 400 והפרומפט פשוט לא קורה — כשל שקט מצד המשתמש.
  it("accepts every legacy name and returns the canonical one", () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_RPC_METHODS)) {
      expect(canonicalRpcMethod(legacy)).toBe(canonical)
    }
  })

  it("accepts a name that is already canonical, unchanged", () => {
    for (const canonical of Object.values(RPC_METHODS)) {
      expect(canonicalRpcMethod(canonical)).toBe(canonical)
    }
  })

  it("returns undefined for an unknown name — the caller decides, not us", () => {
    expect(canonicalRpcMethod("nope")).toBeUndefined()
    expect(canonicalRpcMethod("session/nope")).toBeUndefined()
    expect(canonicalRpcMethod("")).toBeUndefined()
    expect(canonicalRpcMethod(undefined)).toBeUndefined()
  })

  // ⚠️ הגנה מפני "שיפור" עתידי: מפתח-אובייקט ירושתי אינו שם-מתודה.
  it("does not resolve inherited Object properties", () => {
    expect(canonicalRpcMethod("toString")).toBeUndefined()
    expect(canonicalRpcMethod("constructor")).toBeUndefined()
    expect(canonicalRpcMethod("__proto__")).toBeUndefined()
  })
})
