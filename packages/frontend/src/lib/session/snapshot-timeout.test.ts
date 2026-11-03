/**
 * snapshot-timeout.test.ts — ‏עקיפת הטיימאאוט של ה-snapshot ‏מהדפדפן.
 *
 * ‏טבלת-אמת: ‏גלובל ← ‏localStorage ← ‏ברירת-מחדל, ‏נרדפי "‏ללא הגבלה",
 * ‏ה-clamp ‏ל-`2^31-1`, ‏וזבל שחוזר לברירת-המחדל ולא לאפס.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  MAX_TIMER_MS,
  readSnapshotTimeoutMs,
  resolveSnapshotTimeoutMs,
  SNAPSHOT_TIMEOUT_KEY,
  SNAPSHOT_TIMEOUT_MS,
} from "./snapshot-timeout.js"

type GlobalWithOverride = { __dcSnapshotTimeoutMs?: unknown }

afterEach(() => {
  delete (globalThis as GlobalWithOverride).__dcSnapshotTimeoutMs
  vi.unstubAllGlobals()
})

describe("resolveSnapshotTimeoutMs", () => {
  it("‏נעדר → ברירת-מחדל", () => {
    expect(resolveSnapshotTimeoutMs(undefined)).toBe(SNAPSHOT_TIMEOUT_MS)
    expect(resolveSnapshotTimeoutMs(null)).toBe(SNAPSHOT_TIMEOUT_MS)
    expect(resolveSnapshotTimeoutMs("")).toBe(SNAPSHOT_TIMEOUT_MS)
  })

  it("‏מספר → עצמו, ‏גם כמחרוזת עם רווחים", () => {
    expect(resolveSnapshotTimeoutMs(300_000)).toBe(300_000)
    expect(resolveSnapshotTimeoutMs("300000")).toBe(300_000)
    expect(resolveSnapshotTimeoutMs(" 300000 ")).toBe(300_000)
  })

  it("‏אפס וערך שלילי → ללא הגבלה", () => {
    expect(resolveSnapshotTimeoutMs(0)).toBe(MAX_TIMER_MS)
    expect(resolveSnapshotTimeoutMs("0")).toBe(MAX_TIMER_MS)
    expect(resolveSnapshotTimeoutMs(-1)).toBe(MAX_TIMER_MS)
  })

  it("‏נרדפי-מילים → ללא הגבלה, ‏case-insensitive", () => {
    for (const v of ["off", "never", "none", "unlimited", "OFF", " Never "]) {
      expect(resolveSnapshotTimeoutMs(v)).toBe(MAX_TIMER_MS)
    }
  })

  it("🔴 ‏`Infinity` → clamp, ‏ולא טיימאאוט מיידי", () => {
    // ‏נמדד: ‏`setTimeout(fn, Infinity)` ‏גולש ונורה תוך 2ms. ‏בלי ה-clamp
    // ‏ה"ביטול" ‏היה הופך לטיימאאוט **מיידי** — ‏ההפך המדויק מהכוונה.
    expect(resolveSnapshotTimeoutMs(Number.POSITIVE_INFINITY)).toBe(MAX_TIMER_MS)
    expect(resolveSnapshotTimeoutMs("Infinity")).toBe(MAX_TIMER_MS)
  })

  it("‏ערך מעל `2^31-1` ‏נחתך לתקרה", () => {
    expect(resolveSnapshotTimeoutMs(MAX_TIMER_MS + 1)).toBe(MAX_TIMER_MS)
    expect(resolveSnapshotTimeoutMs(1e18)).toBe(MAX_TIMER_MS)
  })

  it("🛑 ‏זבל → ברירת-מחדל, ‏**לא** אפס", () => {
    for (const v of ["abc", "12s", {}, [], Number.NaN, true]) {
      expect(resolveSnapshotTimeoutMs(v)).toBe(SNAPSHOT_TIMEOUT_MS)
    }
  })
})

describe("readSnapshotTimeoutMs", () => {
  const stubStorage = (value: string | null) => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === SNAPSHOT_TIMEOUT_KEY ? value : null),
    })
  }

  it("‏בלי שום עקיפה → ברירת-מחדל", () => {
    stubStorage(null)
    expect(readSnapshotTimeoutMs()).toBe(SNAPSHOT_TIMEOUT_MS)
  })

  it("‏גלובל נקרא", () => {
    stubStorage(null)
    ;(globalThis as GlobalWithOverride).__dcSnapshotTimeoutMs = 120_000
    expect(readSnapshotTimeoutMs()).toBe(120_000)
  })

  it("‏גלובל `0` → ללא הגבלה", () => {
    stubStorage(null)
    ;(globalThis as GlobalWithOverride).__dcSnapshotTimeoutMs = 0
    expect(readSnapshotTimeoutMs()).toBe(MAX_TIMER_MS)
  })

  it("‏localStorage ‏נקרא כשאין גלובל — ‏וזה הערוץ ששורד רענון", () => {
    stubStorage("0")
    expect(readSnapshotTimeoutMs()).toBe(MAX_TIMER_MS)
  })

  it("‏גלובל גובר על localStorage", () => {
    stubStorage("0")
    ;(globalThis as GlobalWithOverride).__dcSnapshotTimeoutMs = 90_000
    expect(readSnapshotTimeoutMs()).toBe(90_000)
  })

  it("🛑 ‏`localStorage` ‏שזורק → ברירת-מחדל, ‏לא חריגה", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError: access denied")
      },
    })
    expect(readSnapshotTimeoutMs()).toBe(SNAPSHOT_TIMEOUT_MS)
  })

  it("‏בלי `localStorage` ‏כלל (SSR) → ברירת-מחדל", () => {
    vi.stubGlobal("localStorage", undefined)
    expect(readSnapshotTimeoutMs()).toBe(SNAPSHOT_TIMEOUT_MS)
  })
})
