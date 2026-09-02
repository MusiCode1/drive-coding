import type { Bubble } from "$lib/types/bubble"
import { stableBubbleKey } from "$lib/util/bubble-key"

/** פריט-תצוגה אחד ברשימה שנכנסת ל-Virtualizer. */
export type DisplayItem =
  | { kind: "single"; key: string; bubble: Bubble }
  | { kind: "activity-group"; key: string; bubbles: Bubble[] }

/** האם הבועה היא "רעש" שנדחס — thought או tool. */
export function isActivityBubble(b: Bubble): boolean {
  return b.kind === "thought" || b.kind === "tool"
}

/**
 * groupActivityRuns — ממפה רשימת בועות לרשימת פריטי-תצוגה.
 *
 * enabled=false → כל בועה חוזרת כ-{kind:"single"} (מסלול-קוד יחיד ב-ChatBubbles).
 * enabled=true  → כל **רצף עוקב מקסימלי** של isActivityBubble נאסף ל-activity-group.
 *
 * מפתחות:
 *   single         → stableBubbleKey(bubble, bubbles)
 *   activity-group → `grp:${stableBubbleKey(run[0], bubbles)}`
 */
export function groupActivityRuns(
  bubbles: readonly Bubble[],
  enabled: boolean,
): DisplayItem[] {
  if (!enabled) {
    return bubbles.map((bubble) => ({
      kind: "single" as const,
      key: stableBubbleKey(bubble, bubbles),
      bubble,
    }))
  }

  const items: DisplayItem[] = []
  let run: Bubble[] = []

  const flushRun = (): void => {
    if (run.length === 0) return
    items.push({
      kind: "activity-group",
      key: `grp:${stableBubbleKey(run[0]!, bubbles)}`,
      bubbles: run,
    })
    run = []
  }

  for (const bubble of bubbles) {
    if (isActivityBubble(bubble)) {
      run.push(bubble)
    } else {
      flushRun()
      items.push({
        kind: "single",
        key: stableBubbleKey(bubble, bubbles),
        bubble,
      })
    }
  }
  flushRun()

  return items
}
