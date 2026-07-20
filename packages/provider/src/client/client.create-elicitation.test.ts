/**
 * client.create-elicitation.test.ts — slice-elicitation-ui Commit 0.
 *
 * `createClientImpl.unstable_createElicitation` מאציל ל-`opts.onCreateElicitation` אם
 * סופק; אחרת default `{action:"cancel"}` (לא לתקוע turn / לא לזרוק method-not-found).
 * מחקה את client.request-permission.test.ts. ר' docs/plans/slice-elicitation-ui.md
 * §4 Commit 0.
 *
 * Tests:
 *   (א) בלי onCreateElicitation → default {action:"cancel"} (לא זורק).
 *   (ב) עם handler → unstable_createElicitation מחזיר בדיוק את מה שה-handler מחזיר (accept).
 *   (ג) handler שדוחה/מבטל → מוחזר כמו-שהוא (decline/cancel).
 */

import type { CreateElicitationRequest } from "@agentclientprotocol/sdk"
import { describe, expect, it, vi } from "vitest"
import { createClientImpl } from "./client-impl.js"

function baseParams(): CreateElicitationRequest {
  return {
    sessionId: "s1",
    mode: "form",
    message: "What is your name?",
    requestedSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    },
  } as CreateElicitationRequest
}

describe("createClientImpl.unstable_createElicitation — onCreateElicitation handoff", () => {
  it("(א) regression: בלי onCreateElicitation → default {action:'cancel'} (לא זורק)", async () => {
    const impl = createClientImpl({ onUpdate: vi.fn() })
    const result = await impl.unstable_createElicitation?.(baseParams())
    expect(result).toEqual({ action: "cancel" })
  })

  it("(ב) עם handler → unstable_createElicitation מחזיר את מה שה-handler מחזיר (accept)", async () => {
    const onCreateElicitation = vi.fn().mockResolvedValue({
      action: "accept",
      content: { name: "Alice" },
    })
    const impl = createClientImpl({ onUpdate: vi.fn(), onCreateElicitation })
    const params = baseParams()
    const result = await impl.unstable_createElicitation?.(params)
    expect(onCreateElicitation).toHaveBeenCalledWith(params)
    expect(result).toEqual({ action: "accept", content: { name: "Alice" } })
  })

  it("(ג) handler שמבטל → cancel מוחזר כמו-שהוא (default לא רץ)", async () => {
    const onCreateElicitation = vi.fn().mockResolvedValue({ action: "cancel" })
    const impl = createClientImpl({ onUpdate: vi.fn(), onCreateElicitation })
    const result = await impl.unstable_createElicitation?.(baseParams())
    expect(result).toEqual({ action: "cancel" })
  })
})
