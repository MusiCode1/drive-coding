/**
 * turn-tracker.ts — module טהור לזיהוי turn פעיל מ-WireSummary (stdout).
 * slice-agent-busy-indicator, Commit 2.
 *
 * עיקרון: ה-BE מריץ קליינט-פענוח עצמאי משלו מעל לוגיקה טהורה משותפת.
 * אפס תלות ב-FE (agent-session.svelte.ts אסור לייבא מכאן).
 * נשען רק על decodeWireLine (wire-decode.ts) → WireSummary.
 *
 * לוגיקה:
 *   - sessionUpdate נוכח → busy=true, lastActivityAt=now
 *   - isBusy(now): true רק אם busy && (now - lastActivityAt) < idleDebounceMs
 *   - result לא מאפס busy (לא אמין כ-turn-end — ר' §4 ב-brief)
 *   - frames לא רלוונטיים → אין שינוי על busy
 *
 * now מוזרק לכל המתודות (דטרמיניזם בטסט).
 */

import type { WireSummary } from "../delivery/wire-decode.js"

export type TurnTracker = {
  /** עדכן מצב מ-frame נכנס (stdout). now מוזרק לדטרמיניזם בטסט. */
  observe(summary: WireSummary, now: number): void
  /** האם יש turn פעיל (פלט לאחרונה ולא הסתיים/לא חלף debounce). */
  isBusy(now: number): boolean
}

export function createTurnTracker(opts?: { idleDebounceMs?: number }): TurnTracker {
  const idleDebounceMs = opts?.idleDebounceMs ?? 1500

  let busy = false
  let lastActivityAt = 0

  return {
    observe(summary: WireSummary, now: number): void {
      // האות החיובי היחיד והאמין: sessionUpdate נוכח (כל ערך)
      // agent_message_chunk / tool_call / tool_call_update / ...
      if (summary.sessionUpdate !== undefined) {
        busy = true
        lastActivityAt = now
      }
      // result לא מאפס busy — לא אמין כ-turn-end (ר' §4 ב-brief).
      // frames לא רלוונטיים ($/ping, unparsed, responseKind, method ללא sessionUpdate)
      // → אין שינוי. debounce-השקט יוריד ל-idle אוטומטית.
    },

    isBusy(now: number): boolean {
      if (!busy) return false
      return (now - lastActivityAt) < idleDebounceMs
    },
  }
}
