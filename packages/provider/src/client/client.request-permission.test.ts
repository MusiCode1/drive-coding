/**
 * client.request-permission.test.ts — slice-permission-ui-basic Commit 0.
 *
 * `createClientImpl.requestPermission` מאציל ל-`opts.onRequestPermission` אם סופק;
 * אחרת נשמרת ההתנהגות ההיסטורית (auto-allow_once).
 *
 * Tests:
 *   (א) בלי onRequestPermission → auto-allow_once (רגרסיה — ההתנהגות הקיימת נשמרת).
 *   (ב) עם handler → requestPermission מחזיר בדיוק את מה שה-handler מחזיר (selected).
 *   (ג) handler שדוחה/מבטל → מוחזר כמו-שהוא (cancelled).
 */

import { describe, expect, it, vi } from "vitest"
import { createClientImpl } from "./client-impl.js"

function baseParams() {
  return {
    sessionId: "s1",
    toolCall: { toolCallId: "t1" },
    options: [
      { optionId: "opt-reject", name: "Reject", kind: "reject_once" },
      { optionId: "opt1", name: "Allow once", kind: "allow_once" },
    ],
  } as Parameters<ReturnType<typeof createClientImpl>["requestPermission"]>[0]
}

describe("createClientImpl.requestPermission — onRequestPermission handoff", () => {
  it("(א) regression: בלי onRequestPermission → auto-allow_once (ההתנהגות הקיימת נשמרת)", async () => {
    const impl = createClientImpl({ onUpdate: vi.fn() })
    const result = await impl.requestPermission(baseParams())
    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "opt1" } })
  })

  it("(ב) עם handler → requestPermission מחזיר את מה שה-handler מחזיר (selected)", async () => {
    const onRequestPermission = vi.fn().mockResolvedValue({
      outcome: { outcome: "selected", optionId: "opt-reject" },
    })
    const impl = createClientImpl({ onUpdate: vi.fn(), onRequestPermission })
    const params = baseParams()
    const result = await impl.requestPermission(params)
    expect(onRequestPermission).toHaveBeenCalledWith(params)
    expect(result).toEqual({ outcome: { outcome: "selected", optionId: "opt-reject" } })
  })

  it("(ג) handler שמבטל → cancelled מוחזר כמו-שהוא (auto-allow לא רץ)", async () => {
    const onRequestPermission = vi.fn().mockResolvedValue({
      outcome: { outcome: "cancelled" },
    })
    const impl = createClientImpl({ onUpdate: vi.fn(), onRequestPermission })
    const result = await impl.requestPermission(baseParams())
    expect(result).toEqual({ outcome: { outcome: "cancelled" } })
  })
})
