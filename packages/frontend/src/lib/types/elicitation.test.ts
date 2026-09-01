/**
 * elicitation.test.ts — TDD: מיפוי `requestedSchema.properties` → view-model לרינדור.
 *
 * Tests:
 *   1. string בלי enum → text field, label=key (בלי title).
 *   2. string עם title → label=title.
 *   3. string עם enum (untitled) → select, options value=label=value.
 *   4. string עם oneOf (titled) → select, options value=const label=title.
 *   5. number/integer → number field.
 *   6. boolean → boolean field.
 *   7. required flag נכון לפי schema.required.
 *   8. טיפוס לא-נתמך (array) מדולג.
 *   9. properties ריק/חסר → מערך ריק.
 *  10. isFormElicitation — true ל-mode:"form", false ל-mode:"url"/custom.
 *  11. ⚠️ enum אינו type נפרד — לא נכתב case "enum" (regression לfinding אביגיל).
 */

import type { ElicitationSchema } from "@agentclientprotocol/sdk"
import { describe, expect, it } from "vitest"
import { type ElicitationParams, isFormElicitation, mapElicitationFields } from "./elicitation.js"

describe("mapElicitationFields", () => {
  it("1. string בלי enum → text field, label=key (בלי title)", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: { name: { type: "string" } },
    }
    expect(mapElicitationFields(schema)).toEqual([
      { key: "name", kind: "text", label: "name", required: false },
    ])
  })

  it("2. string עם title → label=title", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: { name: { type: "string", title: "Full name" } },
    }
    expect(mapElicitationFields(schema)).toEqual([
      { key: "name", kind: "text", label: "Full name", required: false },
    ])
  })

  it("3. string עם enum (untitled) → select, options value=label=value", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: { color: { type: "string", enum: ["red", "blue"] } },
    }
    expect(mapElicitationFields(schema)).toEqual([
      {
        key: "color",
        kind: "select",
        label: "color",
        required: false,
        options: [
          { value: "red", label: "red" },
          { value: "blue", label: "blue" },
        ],
      },
    ])
  })

  it("4. string עם oneOf (titled) → select, options value=const label=title", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        color: {
          type: "string",
          oneOf: [
            { const: "r", title: "Red" },
            { const: "b", title: "Blue" },
          ],
        },
      },
    }
    expect(mapElicitationFields(schema)).toEqual([
      {
        key: "color",
        kind: "select",
        label: "color",
        required: false,
        options: [
          { value: "r", label: "Red" },
          { value: "b", label: "Blue" },
        ],
      },
    ])
  })

  it("4b. string עם description + oneOf descriptions → נשמר במיפוי", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        language: {
          type: "string",
          title: "Language",
          description: "Which interface language do you prefer?",
          oneOf: [
            { const: "he", title: "Hebrew", description: "ממשק בעברית בלבד" },
            { const: "en", title: "English", description: "English-only interface" },
          ],
        },
      },
    }
    expect(mapElicitationFields(schema)).toEqual([
      {
        key: "language",
        kind: "select",
        label: "Language",
        description: "Which interface language do you prefer?",
        required: false,
        options: [
          { value: "he", label: "Hebrew", description: "ממשק בעברית בלבד" },
          { value: "en", label: "English", description: "English-only interface" },
        ],
      },
    ])
  })

  it("5. number/integer → number field", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        age: { type: "integer" },
        score: { type: "number" },
      },
    }
    expect(mapElicitationFields(schema)).toEqual([
      { key: "age", kind: "number", label: "age", required: false },
      { key: "score", kind: "number", label: "score", required: false },
    ])
  })

  it("6. boolean → boolean field", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: { agree: { type: "boolean" } },
    }
    expect(mapElicitationFields(schema)).toEqual([
      { key: "agree", kind: "boolean", label: "agree", required: false },
    ])
  })

  it("7. required flag נכון לפי schema.required", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["name"],
    }
    const result = mapElicitationFields(schema)
    expect(result.find((f) => f.key === "name")?.required).toBe(true)
    expect(result.find((f) => f.key === "nickname")?.required).toBe(false)
  })

  it("8. טיפוס לא-נתמך (array) מדולג", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        // biome-ignore lint/suspicious/noExplicitAny: multi-select (array) — out of scope
        tags: { type: "array", items: { type: "string", enum: ["a"] } } as any,
      },
    }
    expect(mapElicitationFields(schema)).toEqual([
      { key: "name", kind: "text", label: "name", required: false },
    ])
  })

  it("9. properties ריק/חסר → מערך ריק", () => {
    expect(mapElicitationFields({ type: "object", properties: {} })).toEqual([])
    expect(mapElicitationFields({ type: "object" })).toEqual([])
  })
})

describe("isFormElicitation", () => {
  it("10a. mode:'form' → true", () => {
    const params = {
      sessionId: "s1",
      mode: "form",
      message: "hi",
      requestedSchema: { type: "object", properties: {} },
    } as ElicitationParams
    expect(isFormElicitation(params)).toBe(true)
  })

  it("10b. mode:'url' → false", () => {
    const params = {
      sessionId: "s1",
      mode: "url",
      message: "hi",
      url: "https://example.com",
    } as unknown as ElicitationParams
    expect(isFormElicitation(params)).toBe(false)
  })

  it("10c. custom mode → false", () => {
    const params = { sessionId: "s1", mode: "_custom", message: "hi" } as ElicitationParams
    expect(isFormElicitation(params)).toBe(false)
  })
})
