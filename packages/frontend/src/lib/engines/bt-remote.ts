/** §2 של המחקר (תיקון-הקיבוץ): DOWN בתוך 250ms מקודמו = המשך אותו burst. */
export const BURST_GAP_MS = 250
/** §3.3: סף הלחיצה-הארוכה. עקבי ב-7/7 מדידות. */
export const HOLD_THRESHOLD_MS = 400
/**
 * חלון-הבליעה: כמה זמן burst עוקב עוד יכול לבלוע שבר-קדם-החזקה.
 * נגזר: הפער הנמדד שבר→burst הוא ~390-400ms (§3.3), ועוד חלון-קיבוץ אחד לביטחון.
 */
export const PREHOLD_ABSORB_MS = HOLD_THRESHOLD_MS + BURST_GAP_MS // 650
/**
 * **תקרה, לא סף.** מתי מוותרים על `up` שלא הגיע ופולטים את השבר כ-`hold`.
 * לעולם לא פולט `tap`.
 */
export const PREHOLD_TIMEOUT_MS = 5000
/** חלון-דיכוי חוצה-ערוצים. רק בין key ל-media. */
export const CROSS_CHANNEL_DEDUP_MS = BURST_GAP_MS // 250
/** קצב ה-tick שה-route מריץ. */
export const TICK_INTERVAL_MS = 50

export type BtButton = "next" | "prev" | "center"
export type BtChannel = "key" | "media"
export type BtGesture = "tap" | "hold"

export type BtCommand = {
  button: BtButton
  gesture: BtGesture
  channel: BtChannel
  /** ה-DOWN הראשון (כולל שבר-קדם-החזקה שנבלע), או זמן פעולת ה-media. */
  at: number
  /** רגע-הסגירה = רגע-הפליטה. זה מה שה-dedup משווה. */
  emittedAt: number
  /** מה-DOWN הראשון ועד הסגירה. 0 תמיד בערוץ media. */
  holdMs: number
  /** מספר פולסי-ה-DOWN שקובצו. 1 לטאפ ול-media. */
  pulses: number
  closedBy: "up" | "gap" | "action" | "timeout"
}

export type BtKeyEvent = { type: "down" | "up"; code: string; at: number }

export type BtPending = {
  code: string
  button: BtButton
  pulses: number
  elapsedMs: number
  wouldBeHold: boolean
}

export type BtStats = {
  emitted: number
  suppressedCrossChannel: number
  preholdsAbsorbed: number
  preholdTimeouts: number
  preholdGapFlushes: number
  orphanUps: number
}

/** MediaTrackNext→next · MediaTrackPrevious→prev · MediaPlayPause→center · אחר→null */
export function buttonForKeyCode(code: string): BtButton | null {
  switch (code) {
    case "MediaTrackNext":
      return "next"
    case "MediaTrackPrevious":
      return "prev"
    case "MediaPlayPause":
      return "center"
    default:
      return null
  }
}

/** nexttrack→next · previoustrack→prev · play/pause/stop→center · אחר→null */
export function buttonForMediaAction(action: string): BtButton | null {
  switch (action) {
    case "nexttrack":
      return "next"
    case "previoustrack":
      return "prev"
    case "play":
    case "pause":
    case "stop":
      return "center"
    default:
      return null
  }
}

type Burst = {
  code: string
  button: BtButton
  first: number
  last: number
  pulses: number
  absorbed: boolean
}

type Prehold = {
  code: string
  button: BtButton
  at: number
  pulses: number
}

type LastEmit = {
  emittedAt: number
  channel: BtChannel
}

export class BtRemoteEngine {
  #bursts = new Map<string, Burst>()
  #preholds = new Map<string, Prehold>()
  #lastEmit: Partial<Record<BtButton, LastEmit>> = {}
  #stats: BtStats = {
    emitted: 0,
    suppressedCrossChannel: 0,
    preholdsAbsorbed: 0,
    preholdTimeouts: 0,
    preholdGapFlushes: 0,
    orphanUps: 0,
  }

  ingestKey(ev: BtKeyEvent): BtCommand | null {
    const button = buttonForKeyCode(ev.code)
    if (button === null) return null

    if (ev.type === "down") {
      return this.#ingestDown(ev.code, button, ev.at)
    }
    return this.#ingestUp(ev.code, button, ev.at)
  }

  ingestMediaAction(action: string, at: number): BtCommand | null {
    const button = buttonForMediaAction(action)
    if (button === null) return null
    return this.#emit({
      button,
      gesture: "tap",
      channel: "media",
      at,
      emittedAt: at,
      holdMs: 0,
      pulses: 1,
      closedBy: "action",
    })
  }

  tick(now: number): BtCommand[] {
    const out: BtCommand[] = []

    for (const [code, burst] of this.#bursts) {
      if (now - burst.last > BURST_GAP_MS) {
        const cmd = this.#closeBurst(burst, burst.last, "gap")
        this.#bursts.delete(code)
        if (cmd) out.push(cmd)
      }
    }

    for (const [code, prehold] of this.#preholds) {
      if (now - prehold.at > PREHOLD_TIMEOUT_MS) {
        const cmd = this.#emit({
          button: prehold.button,
          gesture: "hold",
          channel: "key",
          at: prehold.at,
          pulses: prehold.pulses,
          holdMs: PREHOLD_TIMEOUT_MS,
          emittedAt: prehold.at + PREHOLD_TIMEOUT_MS,
          closedBy: "timeout",
        })
        this.#preholds.delete(code)
        this.#stats.preholdTimeouts++
        // ‏`#emit` ‏עשוי לדכא (dedup ‏חוצה-ערוצים) ‏ולהחזיר null — ‏המונה סופר את
        // ‏אירוע-התקרה עצמו, ‏אבל רק פקודה שנפלטה בפועל נכנסת לפלט.
        if (cmd) out.push(cmd)
      }
    }

    return out
  }

  pending(now: number): BtPending[] {
    const out: BtPending[] = []

    for (const burst of this.#bursts.values()) {
      const elapsedMs = now - burst.first
      out.push({
        code: burst.code,
        button: burst.button,
        pulses: burst.pulses,
        elapsedMs,
        wouldBeHold: burst.pulses > 1 || elapsedMs >= HOLD_THRESHOLD_MS,
      })
    }

    for (const prehold of this.#preholds.values()) {
      const elapsedMs = now - prehold.at
      out.push({
        code: prehold.code,
        button: prehold.button,
        pulses: prehold.pulses,
        elapsedMs,
        wouldBeHold: prehold.pulses > 1 || elapsedMs >= HOLD_THRESHOLD_MS,
      })
    }

    return out
  }

  get stats(): BtStats {
    return { ...this.#stats }
  }

  reset(): void {
    this.#bursts.clear()
    this.#preholds.clear()
    this.#lastEmit = {}
    this.#stats = {
      emitted: 0,
      suppressedCrossChannel: 0,
      preholdsAbsorbed: 0,
      preholdTimeouts: 0,
      preholdGapFlushes: 0,
      orphanUps: 0,
    }
  }

  #ingestDown(code: string, button: BtButton, at: number): BtCommand | null {
    const existing = this.#bursts.get(code)
    if (existing && at - existing.last <= BURST_GAP_MS) {
      existing.pulses++
      existing.last = at
      return null
    }

    let emitted: BtCommand | null = null

    if (existing) {
      emitted = this.#closeBurst(existing, existing.last, "gap")
      this.#bursts.delete(code)
    }

    const burst: Burst = {
      code,
      button,
      first: at,
      last: at,
      pulses: 1,
      absorbed: false,
    }

    const prehold = this.#preholds.get(code)
    if (prehold) {
      if (at - prehold.at <= PREHOLD_ABSORB_MS) {
        burst.first = prehold.at
        burst.pulses += prehold.pulses
        burst.absorbed = true
        this.#preholds.delete(code)
        this.#stats.preholdsAbsorbed++
      } else {
        const flushCmd = this.#emit({
          button: prehold.button,
          gesture: "hold",
          channel: "key",
          at: prehold.at,
          pulses: prehold.pulses,
          holdMs: at - prehold.at,
          emittedAt: at,
          closedBy: "gap",
        })
        this.#preholds.delete(code)
        this.#stats.preholdGapFlushes++
        if (flushCmd) emitted = flushCmd
      }
    }

    this.#bursts.set(code, burst)
    return emitted
  }

  #ingestUp(code: string, _button: BtButton, at: number): BtCommand | null {
    const burst = this.#bursts.get(code)
    if (burst) {
      const cmd = this.#closeBurst(burst, at, "up")
      this.#bursts.delete(code)
      return cmd
    }

    const prehold = this.#preholds.get(code)
    if (prehold) {
      const holdMs = at - prehold.at
      const cmd = this.#emit({
        button: prehold.button,
        gesture: holdMs >= HOLD_THRESHOLD_MS || prehold.pulses > 1 ? "hold" : "tap",
        channel: "key",
        at: prehold.at,
        pulses: prehold.pulses,
        holdMs,
        emittedAt: at,
        closedBy: "up",
      })
      this.#preholds.delete(code)
      return cmd
    }

    this.#stats.orphanUps++
    return null
  }

  #closeBurst(burst: Burst, at: number, closedBy: "up" | "gap"): BtCommand | null {
    const holdMs = at - burst.first

    if (closedBy === "gap" && burst.pulses === 1 && !burst.absorbed) {
      this.#preholds.set(burst.code, {
        code: burst.code,
        button: burst.button,
        at: burst.first,
        pulses: burst.pulses,
      })
      return null
    }

    const gesture: BtGesture = burst.pulses > 1 || holdMs >= HOLD_THRESHOLD_MS ? "hold" : "tap"

    return this.#emit({
      button: burst.button,
      gesture,
      channel: "key",
      at: burst.first,
      pulses: burst.pulses,
      holdMs,
      emittedAt: at,
      closedBy,
    })
  }

  #emit(cmd: BtCommand): BtCommand | null {
    const last = this.#lastEmit[cmd.button]
    if (
      last &&
      last.channel !== cmd.channel &&
      cmd.emittedAt - last.emittedAt <= CROSS_CHANNEL_DEDUP_MS
    ) {
      this.#stats.suppressedCrossChannel++
      return null
    }

    this.#lastEmit[cmd.button] = {
      emittedAt: cmd.emittedAt,
      channel: cmd.channel,
    }
    this.#stats.emitted++
    return cmd
  }
}
