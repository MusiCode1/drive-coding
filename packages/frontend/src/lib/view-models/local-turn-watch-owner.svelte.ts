/**
 * LocalTurnWatchOwner — reactive owner for turn stall hint + activity clock.
 * Pure evaluation lives in engines/turn-watchdog.ts; this class owns the interval.
 */
import {
  evaluateTurn,
  initialTurnActivity,
  onActivity,
  onTurnEnded,
  onTurnStarted,
  type TurnActivityState,
} from "$lib/engines/turn-watchdog"
import { connWarn } from "$lib/util/conn-log"

export class LocalTurnWatchOwner {
  stalled = $state(false)

  #turnActivity: TurnActivityState = initialTurnActivity()
  #stallTimer: ReturnType<typeof setInterval> | undefined
  readonly #onGiveUp: () => void
  readonly #enabled: boolean

  constructor(opts: { onGiveUp: () => void; enabled: boolean }) {
    this.#onGiveUp = opts.onGiveUp
    this.#enabled = opts.enabled
  }

  start(): void {
    if (!this.#enabled) return
    if (this.#stallTimer !== undefined) return
    this.#stallTimer = setInterval(() => this.#tick(), 5_000)
  }

  stop(): void {
    if (this.#stallTimer !== undefined) {
      clearInterval(this.#stallTimer)
      this.#stallTimer = undefined
    }
    this.#turnActivity = onTurnEnded()
    this.stalled = false
  }

  turnStarted(now?: number): void {
    this.#turnActivity = onTurnStarted(now ?? Date.now())
    this.stalled = false
  }

  turnEnded(): void {
    this.#turnActivity = onTurnEnded()
    this.stalled = false
  }

  noteActivity(now?: number): void {
    this.#turnActivity = onActivity(this.#turnActivity, now ?? Date.now())
    if (this.stalled) this.stalled = false
  }

  #tick(): void {
    const verdict = evaluateTurn(this.#turnActivity, Date.now())
    if (verdict.kind === "ok") {
      if (this.stalled) this.stalled = false
      return
    }
    if (!this.stalled) {
      this.stalled = true
      connWarn("turn-stalled", { silentMs: verdict.silentMs, kind: verdict.kind })
    }
    if (verdict.kind === "give-up") this.#onGiveUp()
  }
}
