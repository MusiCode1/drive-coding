/**
 * audio-playlist.svelte.ts — playlist engine: pure-decision interpreter (Commit 4).
 *
 * Architecture: decidePlaylistAction (core, pure) drives a thin interpreter shell.
 * All external events (reserve, markReady, markError, navigate, pause, resume, stop)
 * are fact-updates + a single wake signal (#bump). The loop reads a snapshot,
 * delegates the decision to the pure function, and interprets the action.
 *
 * Single wake channel (#version + #wake) replaces the four resolvers of the
 * previous implementation (#itemResolvers, #pauseResolve, #navResolve, #parkResolve).
 * No lost wake-ups: #changed(seen) returns immediately if version already moved.
 *
 * play() contract (Commit 2): always resolves — on natural end OR on stop().
 * This removes the need for Promise.race in the play branch.
 *
 * Public API (unchanged from A2/A3/A4/nav-retain — consumers not modified):
 *   reserve, markReady, markError, next, prev, jumpTo, jumpToBubble,
 *   pause, resume, stop, prepareSegmentForBubble, setOnPlaybackStart,
 *   state, transport, items, currentSegmentId, cursor.
 *
 * Internal adapter (R1 — survives until R3/R4):
 *   PlaylistItem with state (7 values), needsRefetch, refetch thunk.
 *   #factsFor maps item.state → SegmentFacts for the pure function.
 */

import { applyNavigation, decidePlaylistAction } from "@drive-coding/core/voice/playlist-decision"
import { compareOrderKey, type OrderKey } from "@drive-coding/core/voice/tts-queue"
import type { AudioSink } from "./audio-sink"
import type { SegmentProducer } from "./segment-producer"

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
  /** A4: bubble id for jumpToBubble + on-demand TTS. */
  bubbleId: string
  /**
   * nav-retain: thunk for re-synthesis.
   * Called when item is in reserved state without a live fetch (skip-cancelled, failed).
   */
  refetch?: () => void
  /**
   * nav-retain fix: true only when item was discarded (skip-cancel) and needs re-synthesis.
   * Regular reserve() items have this off; the live fetch arrives via Speaker.
   */
  needsRefetch?: boolean
}

export type AudioPlaylistState = "idle" | "playing"

/** A3: transport state — separate from state (see note on Speaker.get state). */
export type AudioPlaylistTransport = "playing" | "paused" | "stopped"

export class AudioPlaylist {
  // NOTE: state "idle"|"playing" is written by the loop — NOT derived from currentSegmentId.
  // Speaker.get state reads #player.state==="playing"; pause keeps state="playing".
  state: AudioPlaylistState = $state("idle")
  /** A3: transport field. Default "playing" (immediate playback in most cases). */
  transport: AudioPlaylistTransport = $state("playing")
  currentSegmentId: string | null = $state(null)
  items: PlaylistItem[] = $state([])

  readonly #audioStream: AudioSink
  #onPlaybackStart?: () => void
  readonly #reserveTimeoutMs: number

  // A4: cursor as $state — enables next/prev/jumpTo to change it outside #runLoop.
  #cursor: number = $state(0)

  // Single wake channel (replaces #itemResolvers + #pauseResolve + #navResolve + #parkResolve).
  // Bump increments #version and fires #wake. #changed(seen) sleeps until version > seen.
  // No lost wake-ups: if version already moved when #changed is called, it returns immediately.
  #version = 0
  #wake: (() => void) | null = null

  // Loop lifecycle — prevents two concurrent loops (re-entrancy guard via #runPromise).
  #runPromise: Promise<void> | null = null

  // Timeout tracking for wait-fetch / request-fetch.
  #fetchWaitStartedAt = new Map<string, number>()

  // R3: producer registry — maps segmentId → SegmentProducer (owns fetch lifecycle).
  #producers = new Map<string, SegmentProducer>()

  // One-shot flag: set by prev/jumpTo/jumpToBubble — consumed by next #snapshot().
  // Enables the pure function to distinguish explicit navigation (retry failed items).
  #explicitVisit = false

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
   * A4: allows Speaker to register callback after init (dependency order in +layout).
   */
  setOnPlaybackStart(cb: () => void): void {
    this.#onPlaybackStart = cb
  }

  /**
   * A4: wrapper for #audioStream.prepareSegment — lets BubblePlayer do TTS
   * via the shared stream without holding a direct ref.
   */
  prepareSegmentForBubble(
    segmentId: string,
    stream: ReadableStream<Uint8Array>,
    ac: AbortController,
  ): Promise<void> {
    return this.#audioStream.prepareSegment(segmentId, stream, ac)
  }

  /**
   * Inserts item sorted by orderKey, state=reserved.
   * Starts or wakes the run loop.
   * A3: if transport==="stopped" → reset to "playing" (new queue after stop).
   */
  reserve(
    segmentId: string,
    orderKey: OrderKey,
    bubbleId: string,
    /**
     * R3 Commit 1 — temporary union:
     *   - SegmentProducer (new): stored in #producers; thunk slot left undefined.
     *   - () => void (legacy): stored as refetch thunk on item (dual-write until Commit 4).
     * Union is removed in Commit 4 when the thunk path is deleted.
     */
    producerOrRefetch?: SegmentProducer | (() => void),
  ): void {
    if (this.transport === "stopped") {
      this.transport = "playing"
    }

    // R3: register producer in #producers; keep legacy thunk path for dual-write.
    const refetch =
      typeof producerOrRefetch === "function" ? producerOrRefetch : undefined
    if (producerOrRefetch !== undefined && typeof producerOrRefetch !== "function") {
      this.#producers.set(segmentId, producerOrRefetch)
    }

    const newItem: PlaylistItem = {
      orderKey,
      segmentId,
      state: "reserved",
      bubbleId,
      refetch,
    }
    // sorted-insert by compareOrderKey
    let i = this.items.length
    while (i > 0) {
      const prev = this.items[i - 1]
      if (prev === undefined || compareOrderKey(orderKey, prev.orderKey) >= 0) break
      i--
    }
    this.items.splice(i, 0, newItem)

    this.#ensureRunning()
    this.#bump() // wake the loop (new item or idle-park)
  }

  /**
   * Stream is ready in AudioSink (prepareSegment completed).
   * reserved/loading → ready; wake the loop.
   */
  markReady(segmentId: string): void {
    const item = this.items.find((it) => it.segmentId === segmentId)
    if (item !== undefined && (item.state === "reserved" || item.state === "loading")) {
      item.state = "ready"
    }
    this.#bump()
  }

  /**
   * Fetch failed. reserved/loading → error; wake the loop.
   */
  markError(segmentId: string): void {
    const item = this.items.find((it) => it.segmentId === segmentId)
    if (item !== undefined && (item.state === "reserved" || item.state === "loading")) {
      item.state = "error"
    }
    this.#bump()
  }

  /**
   * A3: pause playback. transport=paused; delegate to AudioSink; loop waits.
   * state stays "playing" (active content — Speaker.get state unchanged).
   */
  pause(): void {
    if (this.transport !== "playing") return
    this.transport = "paused"
    this.#audioStream.pause()
    this.#bump()
  }

  /**
   * A3: resume after pause. transport=playing; delegate to AudioSink; wake loop.
   */
  resume(): void {
    if (this.transport !== "paused") return
    this.transport = "playing"
    this.#audioStream.resume()
    this.#bump()
  }

  // ──────────────────────────────────────────────────────────────────────
  // A4 — navigation: next / prev / jumpTo / jumpToBubble
  // ──────────────────────────────────────────────────────────────────────

  /** A4: cursor (read-only). #runLoop syncs with this field. */
  get cursor(): number {
    return this.#cursor
  }

  /**
   * A4: advance to next sentence. No-op if at end.
   * nav-retain: next — no cancel on target (replay if complete; continue if in-fetch).
   */
  next(): void {
    if (this.#runPromise === null) return
    const nextIdx = this.#cursor + 1
    if (nextIdx >= this.items.length) return
    this.#navigate(nextIdx, false, false) // resetTarget=false, explicit=false
  }

  /**
   * A4: go back to previous sentence (≥ 0).
   */
  prev(): void {
    if (this.#runPromise === null) return
    const prevIdx = this.#cursor - 1
    if (prevIdx < 0) return
    this.#navigate(prevIdx, true, true) // resetTarget=true, explicit=true
  }

  /**
   * A4: jump to index.
   */
  jumpTo(index: number): void {
    if (this.#runPromise === null) return
    if (index < 0 || index >= this.items.length) return
    this.#navigate(index, true, true)
  }

  /**
   * A4: jump to first item of bubble with given bubbleId.
   */
  jumpToBubble(bubbleId: string): void {
    if (this.#runPromise === null) return
    const idx = this.items.findIndex((it) => it.bubbleId === bubbleId)
    if (idx === -1) return
    this.#navigate(idx, true, true)
  }

  /**
   * nav-retain: navigation logic via applyNavigation (pure function).
   * (1) cancel/reset items per NavigationDecision.
   * (2) stop current playing segment so its play() resolves (Commit 2 contract).
   * (3) bump to wake the loop.
   */
  #navigate(target: number, resetTarget: boolean, explicit: boolean): void {
    const nav = applyNavigation(this.#snapshot(), target, resetTarget)

    for (const id of nav.cancel) {
      try {
        this.#audioStream.cancel(id)
      } catch {
        // already cancelled
      }
    }

    for (const id of nav.resetToPending) {
      const it = this.items.find((x) => x.segmentId === id)
      if (it !== undefined) {
        it.state = "reserved"
        it.needsRefetch = true
      }
      this.#fetchWaitStartedAt.delete(id)
    }

    this.#cursor = nav.cursor
    this.#explicitVisit = explicit // consumed by next #snapshot()
    this.#audioStream.stopCurrent?.() // in-flight play() resolves NOW (Commit 2)
    this.#bump()
  }

  /**
   * Stop: transport="stopped" → cancel all pending → clear → bump.
   * The loop will see decide→exit and terminate cleanly.
   * Sync (unchanged from prior implementation — Speaker.#stopAndClear relies on sync).
   */
  stop(): void {
    this.transport = "stopped"
    this.#audioStream.stopCurrent?.()
    for (const item of this.items) {
      if (item.state !== "done" && item.state !== "error" && item.state !== "skipped") {
        try {
          this.#audioStream.cancel(item.segmentId)
        } catch {
          // already cancelled
        }
      }
    }
    this.items = []
    this.#cursor = 0
    this.#fetchWaitStartedAt.clear()
    this.#producers.clear() // R3: release producer refs
    this.state = "idle"
    this.currentSegmentId = null
    this.#bump() // wake loop so it can exit
    // #runPromise reset in finally of #runLoop
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — single wake channel
  // ──────────────────────────────────────────────────────────────────────

  /** Increment version and fire the pending wake (if any). */
  #bump(): void {
    this.#version++
    const wake = this.#wake
    this.#wake = null
    wake?.()
  }

  /**
   * Sleep until #bump() is called with a newer version than `seen`.
   * If version already moved (bump happened before we await), returns immediately.
   * This prevents lost wake-ups.
   */
  #changed(seen: number): Promise<void> {
    if (this.#version !== seen) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.#wake = resolve
    })
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — snapshot + adapter
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Builds a PlaylistSnapshot from the current mutable state.
   * #explicitVisit is consumed (reset to false) after each snapshot.
   */
  #snapshot() {
    const explicit = this.#explicitVisit
    this.#explicitVisit = false
    return {
      items: this.items.map((it) => this.#factsFor(it)),
      cursor: this.#cursor,
      transport: this.transport,
      explicitVisit: explicit,
    }
  }

  /**
   * R1 adapter: maps PlaylistItem (7-state + needsRefetch) → SegmentFacts.
   *
   * fetch mapping:
   *   reserved + needsRefetch=true  → "idle"      (discarded — next visit will request-fetch)
   *   reserved / loading (no refetch) → "in-flight" (Speaker's live fetch is on the way)
   *   error / skipped                → "failed"   (explicitVisit → retry)
   *   ready / playing / done         → "idle"      (result at sink; buffered/playable decide)
   */
  #factsFor(item: PlaylistItem) {
    const id = item.segmentId
    const sink = this.#audioStream
    const now = Date.now()

    let fetch: "idle" | "in-flight" | "failed"
    if (item.state === "error" || item.state === "skipped") {
      fetch = "failed"
    } else if (item.state === "reserved" || item.state === "loading") {
      if (item.needsRefetch === true && item.refetch !== undefined) {
        // discarded with a refetch thunk — request-fetch will call it
        fetch = "idle"
      } else {
        // either a live fetch in-flight (no needsRefetch) OR
        // discarded without a thunk (needs external markReady — treat as in-flight)
        fetch = "in-flight"
      }
    } else {
      fetch = "idle"
    }

    const buffered = (sink as { isComplete?: (id: string) => boolean }).isComplete?.(id) ?? false
    // ready/playing: prepareSegment completed → always playable (data is in sink).
    // done: sink may have released buffer → check isPlayable/isComplete (retain-replay).
    const sinkPlayable =
      (sink as { isPlayable?: (id: string) => boolean }).isPlayable?.(id) ?? buffered
    const playable = item.state === "ready" || item.state === "playing" ? true : sinkPlayable

    const started = this.#fetchWaitStartedAt.get(id) ?? now
    const waitedTooLong = now - started > this.#reserveTimeoutMs

    return {
      segmentId: id,
      fetch,
      playable,
      buffered,
      playedToEnd: item.state === "done",
      waitedTooLong,
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal — run loop
  // ──────────────────────────────────────────────────────────────────────

  /** Start #runLoop if not already running. */
  #ensureRunning(): void {
    if (this.#runPromise === null) {
      this.#runPromise = this.#runLoop()
    }
  }

  /**
   * Thin interpreter: builds snapshot, delegates to decidePlaylistAction, acts.
   * Runs until transport="stopped" (exit action).
   */
  async #runLoop(): Promise<void> {
    this.state = "playing"
    this.#onPlaybackStart?.()
    this.#cursor = 0

    try {
      while (true) {
        const seen = this.#version
        const snap = this.#snapshot()
        const action = decidePlaylistAction(snap)

        switch (action.kind) {
          case "exit":
            return

          case "wait":
            // paused — sleep until bump (resume, stop, navigate)
            await this.#changed(seen)
            break

          case "park": {
            // cursor past end — idle-park: turn off "speaking" indicator
            this.state = "idle"
            this.currentSegmentId = null
            await this.#changed(seen)
            if (this.transport === "stopped") return
            // woken by reserve/navigate — resume speaking
            this.state = "playing"
            this.#onPlaybackStart?.()
            break
          }

          case "skip": {
            const item = this.items[action.index]
            if (item !== undefined && item.state !== "error") {
              item.state = "skipped"
            }
            this.#fetchWaitStartedAt.delete(this.items[action.index]?.segmentId ?? "")
            this.#cursor++
            break
          }

          case "request-fetch": {
            const item = this.items[action.index]
            if (item === undefined) {
              this.#cursor++
              break
            }
            if (item.refetch === undefined) {
              // no producer — skip silently
              item.state = "skipped"
              this.#cursor++
              break
            }
            item.needsRefetch = false // one-shot gate (prevents refetch loop)
            item.refetch()
            // register fetch-start time for waitedTooLong tracking
            if (!this.#fetchWaitStartedAt.has(item.segmentId)) {
              this.#fetchWaitStartedAt.set(item.segmentId, Date.now())
            }
            // fall through to wait for markReady/markError
            const remaining =
              this.#reserveTimeoutMs -
              (Date.now() - (this.#fetchWaitStartedAt.get(item.segmentId) ?? Date.now()))
            await Promise.race([
              this.#changed(seen),
              new Promise<void>((r) => setTimeout(r, Math.max(0, remaining))),
            ])
            break
          }

          case "wait-fetch": {
            const item = this.items[action.index]
            if (item !== undefined && !this.#fetchWaitStartedAt.has(item.segmentId)) {
              this.#fetchWaitStartedAt.set(item.segmentId, Date.now())
            }
            const started =
              this.#fetchWaitStartedAt.get(this.items[action.index]?.segmentId ?? "") ?? Date.now()
            const remaining = this.#reserveTimeoutMs - (Date.now() - started)
            await Promise.race([
              this.#changed(seen),
              new Promise<void>((r) => setTimeout(r, Math.max(0, remaining))),
            ])
            break
          }

          case "play": {
            const item = this.items[action.index]
            if (item === undefined) {
              this.#cursor++
              break
            }
            const id = item.segmentId
            item.state = "playing"
            this.currentSegmentId = id
            try {
              // No Promise.race — play() always resolves (Commit 2 contract).
              // stop() calls stopCurrent() which causes play() to resolve immediately.
              await this.#audioStream.play(id)
            } catch {
              // error → skip
              item.state = "skipped"
              this.#fetchWaitStartedAt.delete(id)
              this.currentSegmentId = null
              this.#cursor++
              break
            }
            this.#fetchWaitStartedAt.delete(id)
            this.currentSegmentId = null
            // Check if navigation changed cursor during play
            if (this.items[this.#cursor]?.segmentId === id) {
              item.state = "done"
              this.#cursor++
            }
            // else: navigation happened — cursor already moved, item.state was reset by #navigate
            break
          }
        }
      }
    } finally {
      this.#runPromise = null
      this.state = "idle"
      this.currentSegmentId = null
      this.#wake = null
    }
  }
}
