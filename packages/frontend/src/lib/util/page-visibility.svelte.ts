/**
 * page-visibility.svelte.ts — מעקב נראות טאב יחיד (slice liveness C3).
 *
 * שלושה מימושים היו קיימים (wake-lock, agent-session.#pageHidden, ActiveProcessesPanel).
 * זה המקור המשותף לסקר presence; wake-lock ו-#pageHidden נשארים לתפקידים שלהם.
 */

let hidden = $state(false)
let initialized = false
const visibleListeners = new Set<() => void>()

function notifyVisible() {
  for (const cb of visibleListeners) cb()
}

/** מאתחל מאזין visibilitychange פעם אחת. מחזיר dispose. */
export function initPageVisibility(): () => void {
  if (typeof document === "undefined") return () => {}
  if (initialized) return () => {}
  initialized = true
  hidden = document.hidden
  const onChange = () => {
    const wasHidden = hidden
    hidden = document.hidden
    if (wasHidden && !hidden) notifyVisible()
  }
  document.addEventListener("visibilitychange", onChange)
  return () => {
    document.removeEventListener("visibilitychange", onChange)
    initialized = false
    visibleListeners.clear()
  }
}

/** קריאה ריאקטיבית — קרא מתוך $effect כדי לעקוב אחרי מצב hidden. */
export function isPageHidden(): boolean {
  return hidden
}

/** מנוי לחזרה לגלוי (focus/visibility) — לטיק presence מיידי. */
export function onPageBecameVisible(cb: () => void): () => void {
  visibleListeners.add(cb)
  return () => visibleListeners.delete(cb)
}

/** @internal לטסטים בלבד */
export function _setPageHiddenForTest(value: boolean): void {
  const wasHidden = hidden
  hidden = value
  if (wasHidden && !value) notifyVisible()
}

/** @internal לטסטים בלבד */
export function _resetPageVisibilityForTest(): void {
  hidden = false
  initialized = false
  visibleListeners.clear()
}
