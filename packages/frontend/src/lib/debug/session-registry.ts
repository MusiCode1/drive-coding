/**
 * session-registry.ts — רישום מופעי-view חיים, לצורך תצפית בלבד.
 *
 * למה קיים: באבחון #41 לא הייתה שום דרך לענות על "כמה מופעים חיים כרגע?"
 * ולכן ההשערה "מופע כפול" נשארה תלויה. `Set` של WeakRef עונה על זה בזול.
 *
 * ⚠️ **תצפית בלבד.** אף קוד-מוצר לא ייקרא מכאן. הרישום עצמו אינו מגודר —
 * עלותו זניחה (Set עם מופע אחד) — אבל **החשיפה ל-window מגודרת** (`dc.ts`).
 */

/** תמונת-מצב שטוחה של view. אף פעם לא רפרנס חי. */
export type ViewDebugInfo = {
  agentId: string
  sessionId: string | null
  lastVersion: number
  messages: number
  status: string
  turnState: string
  closed: boolean
}

export type DebuggableView = { debugInfo(): ViewDebugInfo }

const live = new Set<DebuggableView>()

export function registerView(v: DebuggableView): void {
  live.add(v)
}

export function unregisterView(v: DebuggableView): void {
  live.delete(v)
}

/** מופעים חיים, כתמונות-מצב. יותר מאחד ⇒ ממצא. */
export function listViews(): ViewDebugInfo[] {
  return [...live].map((v) => v.debugInfo())
}
