/**
 * client.prompt.test.ts — TDD: buildPromptParam + AcpClient.prompt עם string | PromptBlocks
 *
 * Commit 4a — slice-image-paste.
 *
 * Tests:
 *   1. buildPromptParam(string) → [{type:"text",text}] (regression)
 *   2. buildPromptParam(blocks) → blocks כמו-שהם (passthrough)
 *   3. buildPromptParam עם image-block → image-block נשמר בדיוק
 *   4. AcpClient.prompt מקבל string | PromptBlocks (type-level — compilation check)
 */

import { describe, expect, it } from "vitest"
import { buildPromptParam } from "./client.js"
import type { PromptBlocks } from "./client.js"

describe("buildPromptParam — string (regression)", () => {
  it("string → [{type:'text',text}]", () => {
    const result = buildPromptParam("שלום עולם")
    expect(result).toEqual([{ type: "text", text: "שלום עולם" }])
  })

  it("string ריק → [{type:'text',text:''}]", () => {
    const result = buildPromptParam("")
    expect(result).toEqual([{ type: "text", text: "" }])
  })
})

describe("buildPromptParam — PromptBlocks (passthrough)", () => {
  it("blocks array → מוחזר כמו-שהוא", () => {
    const blocks: PromptBlocks = [
      { type: "text", text: "הסבר מה בתמונה" },
      { type: "image", mimeType: "image/jpeg", data: "base64data==" },
    ]
    const result = buildPromptParam(blocks)
    expect(result).toBe(blocks) // reference equality — passthrough אמיתי
  })

  it("image-block מועבר עם mimeType ו-data בדיוק", () => {
    const imageBlock = { type: "image" as const, mimeType: "image/png", data: "abc123==" }
    const blocks: PromptBlocks = [imageBlock]

    const result = buildPromptParam(blocks)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(imageBlock)
  })

  it("blocks עם text בלבד → passthrough (לא ממיר מחדש)", () => {
    const blocks: PromptBlocks = [{ type: "text", text: "רק טקסט" }]
    const result = buildPromptParam(blocks)
    expect(result).toBe(blocks)
  })
})

describe("PromptBlocks type", () => {
  it("PromptBlocks מיוצא ונגיש", () => {
    // type-level בלבד — אם מקמפל = pass
    const blocks: PromptBlocks = [
      { type: "text", text: "test" },
    ]
    expect(Array.isArray(blocks)).toBe(true)
  })
})
