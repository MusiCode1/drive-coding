/**
 * tee-acp-callbacks.test.ts — ה-tee שמחלק update notifications בין ה-VM (primary)
 * ל-LocalSessionView (observer).
 *
 * slice local-view-wiring C2 (TDD): ה-VM הוא primary — ראשון, לא עטוף; ה-observer
 * עטוף ב-try/catch. רק onUpdate + onExtNotification — onRequestPermission/
 * onCreateElicitation מחזירים ערך, שני עונים = תשובה כפולה.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClientCallbacks } from "@drive-coding/provider/client"
import { describe, expect, it, vi } from "vitest"
import { teeAcpCallbacks } from "./tee-acp-callbacks"

function makeCallbacks(): AcpClientCallbacks & {
  onUpdate: ReturnType<typeof vi.fn<(n: SessionNotification) => void>>
  onExtNotification: ReturnType<typeof vi.fn<(m: string, p: Record<string, unknown>) => void>>
  onRequestPermission: ReturnType<
    typeof vi.fn<() => Promise<{ outcome: { outcome: "cancelled" } }>>
  >
  onCreateElicitation: ReturnType<typeof vi.fn<() => Promise<{ action: "cancel" }>>>
} {
  return {
    onUpdate: vi.fn((_n: SessionNotification) => {}),
    onExtNotification: vi.fn((_m: string, _p: Record<string, unknown>) => {}),
    onRequestPermission: vi.fn(async () => ({ outcome: { outcome: "cancelled" as const } })),
    onCreateElicitation: vi.fn(async () => ({ action: "cancel" as const })),
  }
}

function makeObserver(): {
  onUpdate: ReturnType<typeof vi.fn<(n: SessionNotification) => void>>
  onExtNotification: ReturnType<typeof vi.fn<(m: string, p: Record<string, unknown>) => void>>
} {
  return {
    onUpdate: vi.fn((_n: SessionNotification) => {}),
    onExtNotification: vi.fn((_m: string, _p: Record<string, unknown>) => {}),
  }
}

describe("teeAcpCallbacks", () => {
  it("onUpdate מגיע לשניהם — ה-VM ראשון", () => {
    const order: string[] = []
    const primary = makeCallbacks()
    primary.onUpdate.mockImplementation(() => order.push("primary"))
    const observer = makeObserver()
    observer.onUpdate.mockImplementation(() => order.push("observer"))

    const teed = teeAcpCallbacks(primary, observer)
    teed.onUpdate?.({ update: {} } as never)
    teed.onUpdate?.({ update: {} } as never)

    expect(primary.onUpdate).toHaveBeenCalledTimes(2)
    expect(observer.onUpdate).toHaveBeenCalledTimes(2)
    expect(order).toEqual(["primary", "observer", "primary", "observer"])
  })

  it("onExtNotification מגיע לשניהם, primary ראשון", () => {
    const order: string[] = []
    const primary = makeCallbacks()
    primary.onExtNotification.mockImplementation((m: string) => order.push(`p:${m}`))
    const observer = makeObserver()
    observer.onExtNotification.mockImplementation((m: string) => order.push(`o:${m}`))

    const teed = teeAcpCallbacks(primary, observer)
    teed.onExtNotification?.("_drive/capabilities", { mock: true })

    expect(order).toEqual(["p:_drive/capabilities", "o:_drive/capabilities"])
  })

  it("throw של ה-observer אינו מגיע ל-VM — ה-primary כבר רץ", () => {
    const primary = makeCallbacks()
    const observer = makeObserver()
    observer.onUpdate.mockImplementation(() => {
      throw new Error("observer exploded")
    })

    const teed = teeAcpCallbacks(primary, observer)
    expect(() => teed.onUpdate?.({ update: {} } as never)).not.toThrow()
    expect(primary.onUpdate).toHaveBeenCalledTimes(1)
  })

  it("throw של ה-observer ב-onExtNotification אינו מגיע ל-VM", () => {
    const primary = makeCallbacks()
    const observer = makeObserver()
    observer.onExtNotification.mockImplementation(() => {
      throw new Error("observer exploded")
    })

    const teed = teeAcpCallbacks(primary, observer)
    expect(() => teed.onExtNotification?.("_drive/x", {})).not.toThrow()
    expect(primary.onExtNotification).toHaveBeenCalledTimes(1)
  })

  it("onRequestPermission/onCreateElicitation אינם מגיעים ל-observer", () => {
    const primary = makeCallbacks()
    const observer = makeObserver()

    const teed = teeAcpCallbacks(primary, observer)
    const permissionParams = { sessionId: "s", toolCall: {} }
    teed.onRequestPermission?.(permissionParams as never)
    teed.onCreateElicitation?.({ message: "?" } as never)

    // ה-observer קיבל רק מה שהוא חתום עליו — לא בקשת-הרשאה ולא elicitation
    expect(observer.onUpdate).not.toHaveBeenCalled()
    expect(observer.onExtNotification).not.toHaveBeenCalled()
    // והם עוברים ב-זהות (spread) — לא עטופים: התשובה חוזרת מ-primary בלבד
    expect(teed.onRequestPermission).toBe(primary.onRequestPermission)
    expect(teed.onCreateElicitation).toBe(primary.onCreateElicitation)
    expect(primary.onRequestPermission).toHaveBeenCalledWith(permissionParams)
  })

  it("observer אופציונלי — עובד גם בלי onExtNotification", () => {
    const primary = makeCallbacks()
    const observer = { onUpdate: vi.fn() as AcpClientCallbacks["onUpdate"] }

    const teed = teeAcpCallbacks(primary, observer)
    teed.onUpdate?.({ update: {} } as never)
    teed.onExtNotification?.("_drive/x", {})

    expect(observer.onUpdate).toHaveBeenCalledTimes(1)
    expect(primary.onExtNotification).toHaveBeenCalledTimes(1) // לא נשבר מהיעדר handler
  })
})
