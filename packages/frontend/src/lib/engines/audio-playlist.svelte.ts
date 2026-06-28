/**
 * audio-playlist.svelte.ts — פלייליסט-מקטעים עם reserve-on-enqueue.
 *
 * refactor מ-player.svelte.ts (slice A2). ה-API החדש:
 *   reserve(segmentId, orderKey)  ← Speaker.#enqueue (מיד — לפני fetch)
 *   markReady(segmentId)          ← Speaker.#fetchJob (אחרי prepareSegment)
 *   markError(segmentId)          ← Speaker.#fetchJob (catch)
 *
 * ה-#playLoop נע על cursor; ממתין על item עד ready/error/timeout → play(id)
 * דרך AudioSink. cursor-based (לא takeNext) — מאפשר prev/next ב-A4.
 *
 * מה לא משתנה: AudioSink ממשק (play/prepareSegment/cancel/clear) נשאר זהה.
 * dead-code שלא הועבר: jumpToSegment (אביגיל #1 — 0 צרכנים).
 */

import { compareOrderKey, type OrderKey } from "@drive-coding/core/voice/tts-queue"
import type { AudioSink } from "./audio-sink"

export type PlaylistItemState =
  | "reserved"
  | "loading"
  | "ready"
  | "playing"
  | "done"
  | "error"
  | "skipped"

export type PlaylistItem = {
  orderKey: OrderKey
  segmentId: string
  state: PlaylistItemState
}

export type AudioPlaylistState = "idle" | "playing"

export class AudioPlaylist {
  state: AudioPlaylistState = $state("idle") // transport מלא ב-A3
  currentSegmentId: string | null = $state(null)
  items: PlaylistItem[] = $state([]) // ממוין לפי orderKey; reactive לתצוגה עתידית

  readonly #audioStream: AudioSink
  readonly #onPlaybackStart?: () => void
  readonly #reserveTimeoutMs: number
  #playing = false // re-entrancy guard
  #stopped = false // אמת כש-stop() נקרא — #playLoop בודק אחרי כל await
  // לכל item ממתין — פונקציה שמפעילה אותו (נקראת כש-markReady/markError)
  #itemResolvers: Map<string, () => void> = new Map()

  constructor(
    audioStream: AudioSink,
    onPlaybackStart?: () => void,
    opts?: { reserveTimeoutMs?: number },
  ) {
    this.#audioStream = audioStream
    this.#onPlaybackStart = onPlaybackStart
    this.#reserveTimeoutMs = opts?.reserveTimeoutMs ?? 20_000
  }

  /**
   * מכניס item ממוין לפי orderKey, state=reserved.
   * מתחיל #playLoop אם idle.
   */
  reserve(segmentId: string, orderKey: OrderKey): void {
    const newItem: PlaylistItem = { orderKey, segmentId, state: "reserved" }
    // sorted-insert לפי compareOrderKey
    let i = this.items.length
    while (i > 0) {
      const prev = this.items[i - 1]
      if (prev === undefined || compareOrderKey(orderKey, prev.orderKey) >= 0) break
      i--
    }
    this.items.splice(i, 0, newItem)

    if (!this.#playing) {
      void this.#playLoop()
    }
  }

  /**
   * ה-stream מוכן ב-AudioSink (prepareSegment הסתיים).
   * reserved/loading → ready, ומאותת ל-#playLoop.
   */
  markReady(segmentId: string): void {
    const item = this.items.find((it) => it.segmentId === segmentId)
    if (item !== undefined && (item.state === "reserved" || item.state === "loading")) {
      item.state = "ready"
    }
    // אות ל-playLoop שמחכה על item זה
    this.#itemResolvers.get(segmentId)?.()
  }

  /**
   * ה-fetch נכשל. reserved/loading → error, ומאותת ל-#playLoop.
   */
  markError(segmentId: string): void {
    const item = this.items.find((it) => it.segmentId === segmentId)
    if (item !== undefined && (item.state === "reserved" || item.state === "loading")) {
      item.state = "error"
    }
    this.#itemResolvers.get(segmentId)?.()
  }

  /**
   * עצירה: מבטל את כל ה-items הממתינים, מנקה items + cursor.
   * A3 ירחיב ל-pause/resume.
   */
  stop(): void {
    this.#stopped = true
    // בטל סגמנטים שכבר ב-AudioSink (playing/ready/reserved)
    for (const item of this.items) {
      if (item.state !== "done" && item.state !== "error" && item.state !== "skipped") {
        try {
          this.#audioStream.cancel(item.segmentId)
        } catch {
          // כבר בוטל
        }
      }
    }
    // פתור את כל ה-resolvers כדי לשחרר המתנות תקועות (#playLoop יבדוק #stopped)
    for (const resolve of this.#itemResolvers.values()) {
      resolve()
    }
    this.#itemResolvers.clear()
    this.items = []
    this.#playing = false
    this.#stopped = false // אפס כדי לאפשר reserve() עתידי
    this.state = "idle"
    this.currentSegmentId = null
  }

  // ──────────────────────────────────────────────────────────────────────
  // פנימי — #playLoop
  // ──────────────────────────────────────────────────────────────────────

  async #playLoop(): Promise<void> {
    if (this.#playing) return
    this.#playing = true
    this.state = "playing"
    this.#onPlaybackStart?.()

    try {
      let cursor = 0
      while (cursor < this.items.length) {
        // בדוק stop() שנקרא תוך כדי await
        if (this.#stopped) break

        const item = this.items[cursor]
        if (item === undefined) {
          cursor++
          continue
        }

        if (item.state === "reserved" || item.state === "loading") {
          // המתן עד שה-item ישתנה (markReady/markError) או timeout
          const resolved = await this.#waitForItem(item.segmentId)
          if (this.#stopped) break // stop() נקרא תוך כדי המתנה
          if (!resolved) {
            // timeout
            item.state = "skipped"
            cursor++
            continue
          }
          // לאחר המתנה — בדוק מחדש
        }

        // re-read state אחרי await (TypeScript לא מצר את ה-state אחרי await)
        const currentState = item.state
        if (currentState === "error" || currentState === "skipped") {
          cursor++
          continue
        }

        if (currentState === "ready") {
          item.state = "playing"
          this.currentSegmentId = item.segmentId
          try {
            await this.#audioStream.play(item.segmentId)
          } catch {
            // MIN-5: בוטל / שגיאה → דלג, המשך לבא בתור (best-effort)
          }
          if (this.#stopped) break // stop() נקרא תוך כדי play
          item.state = "done"
          this.currentSegmentId = null
          cursor++
          continue
        }

        // done או כל state אחר — המשך
        cursor++
      }
    } finally {
      this.#playing = false
      this.state = "idle"
      this.currentSegmentId = null
    }
  }

  /**
   * ממתין עד שה-item מסומן ready/error (ע"י markReady/markError),
   * עד stop() שקורא לכל resolver, או עד timeout.
   * מחזיר true אם ה-item קיבל resolution, false אם timeout.
   */
  #waitForItem(segmentId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let done = false

      const onReady = () => {
        if (done) return
        done = true
        this.#itemResolvers.delete(segmentId)
        clearTimeout(timer)
        resolve(true)
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true
        this.#itemResolvers.delete(segmentId)
        resolve(false)
      }, this.#reserveTimeoutMs)

      this.#itemResolvers.set(segmentId, onReady)
    })
  }
}
