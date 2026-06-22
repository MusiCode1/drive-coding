/**
 * WakeLockEngine — מנהל Screen Wake Lock API.
 *
 * זה engine (engines/), לא VM: owner של WakeLockSentinel, ללא $state.
 * Browser-only — SSR guard מובנה.
 *
 * slice-wake-lock (Track C — drive-first chrome)
 *
 * דרישות התנהגות:
 *  1. #sentinel פרטי. #acquire לא תופס פעמיים (guard null-check).
 *  2. SSR guard: typeof navigator === "undefined" || !("wakeLock" in navigator) → no-op.
 *  3. navigator.wakeLock.request("screen") עטוף ב-try/catch — דחייה = no-op שקט.
 *  4. race-guard אחרי await: אם enabled התהפך או הטאב הוסתר → שחרר sentinel שהתקבל.
 *  5. האזן ל-release event של sentinel → אפס #sentinel = null.
 *  6. visibilitychange → reconcile: enabled && visible → acquire, אחרת release.
 *     listener מאוגד פעם אחת (אותה הפניה ל-add/remove).
 *  7. setEnabled(false) מסיר listener ומשחרר נעילה קיימת.
 */

export class WakeLockEngine {
  #sentinel: WakeLockSentinel | null = null
  #enabled: boolean = false
  #boundReconcile: (() => void) | null = null

  /**
   * אידמפוטנטי. true → מאזין ל-visibilitychange + מבקש נעילה (אם גלוי).
   * false → מסיר listener + משחרר. לעולם לא זורק.
   */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
    if (enabled) {
      this.#attachListener()
      void this.#acquire()
    } else {
      this.#detachListener()
      void this.#release()
    }
  }

  /** ניקוי ב-teardown (שקול ל-setEnabled(false)). סינכרוני במכוון. */
  dispose(): void {
    this.setEnabled(false)
  }

  // ─── private helpers ─────────────────────────────────────────────────────

  #isSupported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator
  }

  async #acquire(): Promise<void> {
    if (!this.#isSupported()) return
    if (this.#sentinel !== null) return // כבר יש sentinel פעיל — אל תתפוס שוב

    // שמור reference ל-enabled לפני ה-await (race-guard)
    const enabledBefore = this.#enabled

    let sentinel: WakeLockSentinel
    try {
      sentinel = await navigator.wakeLock.request("screen")
    } catch {
      return // דחייה (סוללה / לא secure-context / לא גלוי) — no-op שקט
    }

    // race-guard אחרי await: אם enabled התהפך או הטאב הוסתר — שחרר מיד
    if (!this.#enabled || !enabledBefore || document.visibilityState !== "visible") {
      try {
        await sentinel.release()
      } catch {
        /* no-op */
      }
      return
    }

    this.#sentinel = sentinel

    // האזן ל-release event — המערכת משחררת לבד כשהטאב מוסתר
    sentinel.addEventListener("release", () => {
      this.#sentinel = null
    })
  }

  async #release(): Promise<void> {
    const s = this.#sentinel
    if (s === null) return
    this.#sentinel = null
    try {
      await s.release()
    } catch {
      // no-op שקט
    }
  }

  #reconcile(): void {
    if (this.#enabled && document.visibilityState === "visible") {
      void this.#acquire()
    } else {
      void this.#release()
    }
  }

  #attachListener(): void {
    if (this.#boundReconcile !== null) return // כבר מאוגד
    this.#boundReconcile = () => this.#reconcile()
    document.addEventListener("visibilitychange", this.#boundReconcile)
  }

  #detachListener(): void {
    if (this.#boundReconcile === null) return
    document.removeEventListener("visibilitychange", this.#boundReconcile)
    this.#boundReconcile = null
  }
}
