/**
 * turn-tracker.test.ts — TDD לוגיקה טהורה.
 * slice-agent-busy-indicator, Commit 2.
 *
 * TurnTracker: module טהור שמחזיק busy-state פר-agent מתוך WireSummary.
 * לוגיקה: debounce-שקט הוא המנגנון העיקרי.
 *   - sessionUpdate נוכח → busy=true, lastActivityAt=now
 *   - isBusy(now): true רק אם busy && (now - lastActivityAt) < idleDebounceMs
 *   - result לא מאפס busy (לא אמין כ-turn-end — ר' §4 ב-brief)
 *   - frames לא רלוונטיים → אין שינוי על busy
 *
 * now מוזרק לדטרמיניזם בטסט.
 */

import { describe, expect, it } from "vitest"
import { createTurnTracker } from "./turn-tracker.js"

const DEFAULT_DEBOUNCE = 1500

describe("TurnTracker — debounce-שקט", () => {
  // ─── תרחיש 1: sessionUpdate → isBusy מיד ───────────────────────────────────
  it("1. observe sessionUpdate → isBusy=true מיד", () => {
    const tracker = createTurnTracker({ idleDebounceMs: DEFAULT_DEBOUNCE })
    const now = 1000

    tracker.observe({ unparsed: false, sessionUpdate: "agent_message_chunk" }, now)
    expect(tracker.isBusy(now)).toBe(true)
  })

  // ─── תרחיש 2: sessionUpdate + result, שקט < debounce → isBusy=true ─────────
  it("2. sessionUpdate ואז responseKind=result, שקט < debounce → isBusy=true (result לא מאפס)", () => {
    const tracker = createTurnTracker({ idleDebounceMs: DEFAULT_DEBOUNCE })
    const t0 = 1000

    tracker.observe({ unparsed: false, sessionUpdate: "agent_message_chunk" }, t0)
    // result מגיע — לא אמור לאפס busy
    tracker.observe({ unparsed: false, responseKind: "result", id: 1 }, t0 + 100)

    // שקט 500ms — פחות מ-debounce (1500ms)
    expect(tracker.isBusy(t0 + 500)).toBe(true)
  })

  // ─── תרחיש 3: sessionUpdate + שקט > debounce → isBusy=false ────────────────
  it("3. sessionUpdate ואז שקט > debounce → isBusy=false", () => {
    const tracker = createTurnTracker({ idleDebounceMs: DEFAULT_DEBOUNCE })
    const t0 = 1000

    tracker.observe({ unparsed: false, sessionUpdate: "agent_message_chunk" }, t0)

    // שקט 2000ms — יותר מ-debounce (1500ms)
    expect(tracker.isBusy(t0 + 2000)).toBe(false)
  })

  // ─── תרחיש 4: sessionUpdate + שקט < debounce → isBusy=true ─────────────────
  it("4. sessionUpdate, שקט < debounce → isBusy=true", () => {
    const tracker = createTurnTracker({ idleDebounceMs: DEFAULT_DEBOUNCE })
    const t0 = 5000

    tracker.observe({ unparsed: false, sessionUpdate: "tool_call" }, t0)

    // שקט 1000ms — פחות מ-debounce (1500ms)
    expect(tracker.isBusy(t0 + 1000)).toBe(true)
  })

  // ─── תרחיש 5: frame לא רלוונטי → לא מדליק busy ─────────────────────────────
  it("5. frame לא רלוונטי ($/ping / unparsed / result בלבד) → לא מדליק busy", () => {
    const tracker = createTurnTracker({ idleDebounceMs: DEFAULT_DEBOUNCE })
    const now = 2000

    // $/ping — method ללא sessionUpdate
    tracker.observe({ unparsed: false, method: "$/ping" }, now)
    expect(tracker.isBusy(now)).toBe(false)

    // unparsed
    tracker.observe({ unparsed: true }, now)
    expect(tracker.isBusy(now)).toBe(false)

    // result בלבד (ללא sessionUpdate)
    tracker.observe({ unparsed: false, responseKind: "result", id: 42 }, now)
    expect(tracker.isBusy(now)).toBe(false)

    // method עם id (JSON-RPC request) ללא sessionUpdate
    tracker.observe({ unparsed: false, method: "session/new", id: 1 }, now)
    expect(tracker.isBusy(now)).toBe(false)
  })

  // ─── תרחיש 6: רצף chunks — כל אחד מאפס lastActivity → נשאר busy ────────────
  it("6. רצף chunks מרובים — כל אחד מאפס lastActivity → נשאר busy לאורך הרצף", () => {
    const tracker = createTurnTracker({ idleDebounceMs: DEFAULT_DEBOUNCE })
    const t0 = 0

    // 5 chunks עם מרווח 600ms בין כל אחד (פחות מ-debounce)
    for (let i = 0; i < 5; i++) {
      tracker.observe({ unparsed: false, sessionUpdate: "agent_message_chunk" }, t0 + i * 600)
    }

    // מיד אחרי ה-chunk האחרון (t=2400) — עדיין busy
    expect(tracker.isBusy(t0 + 2400)).toBe(true)

    // 1000ms אחרי ה-chunk האחרון (t=3400) — פחות מ-debounce → עדיין busy
    expect(tracker.isBusy(t0 + 3400)).toBe(true)

    // 2000ms אחרי ה-chunk האחרון (t=4400) — יותר מ-debounce → idle
    expect(tracker.isBusy(t0 + 4400)).toBe(false)
  })
})
