<script lang="ts">
/**
 * LiveTranscript — streaming Live secretary transcript (not bubbles).
 *
 * Slice: live-ears, Commit 7.
 * Slice: live-transcript-box — scroll ceiling + auto-follow.
 */

import { getI18n, getLive, getVoiceMode } from "$lib/context"
import { computeScrollEdges, shouldFollowJump } from "$lib/util/scroll-follow"
import {
  LIVE_TRANSCRIPT_FOLLOW_DISTANCE_LINES,
  LIVE_TRANSCRIPT_SENTINEL_MARGIN,
} from "./live-transcript-scroll-config"

const live = getLive()
const voiceMode = getVoiceMode()
const t = getI18n().t

let scrollEl = $state<HTMLElement | null>(null)
let following = $state(true)
let lastJumpAt = 0
let userIntentUntil = 0
let isAtBottom = $state(true)
let lineHeight = 24

function hasUserIntent(): boolean {
  return performance.now() < userIntentUntil
}

function markUserIntent(): void {
  userIntentUntil = performance.now() + 600
}

function getLineHeight(): number {
  if (!scrollEl) return 24
  const computed = getComputedStyle(scrollEl).lineHeight
  if (computed === "normal") return 24
  const parsed = parseFloat(computed)
  return Number.isNaN(parsed) ? 24 : parsed
}

function checkEdges(): void {
  if (!scrollEl) return
  const edges = computeScrollEdges({
    scrollOffset: scrollEl.scrollTop,
    scrollSize: scrollEl.scrollHeight,
    viewportSize: scrollEl.clientHeight,
    sentinelMargin: LIVE_TRANSCRIPT_SENTINEL_MARGIN,
  })
  isAtBottom = edges.atBottom
}

function jumpToBottom(): void {
  if (!scrollEl) return
  scrollEl.scrollTop = scrollEl.scrollHeight
  lastJumpAt = performance.now()
  isAtBottom = true
}

function maybeJump(): void {
  if (!scrollEl) return

  const distanceBelow = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
  checkEdges()

  if (
    shouldFollowJump({
      following,
      distanceBelow,
      lineHeight,
      now: performance.now(),
      lastJumpAt,
      distanceLines: LIVE_TRANSCRIPT_FOLLOW_DISTANCE_LINES,
    })
  ) {
    jumpToBottom()
  }
}

function onScroll(): void {
  checkEdges()
  if (isAtBottom) {
    if (!following) following = true
  } else if (hasUserIntent()) {
    following = false
  }
}

let resizeObs: ResizeObserver | null = null

$effect(() => {
  const el = scrollEl
  if (!el) return

  lineHeight = getLineHeight()

  if (typeof ResizeObserver !== "undefined") {
    resizeObs = new ResizeObserver(() => {
      maybeJump()
    })
    const contentEl = el.firstElementChild as HTMLElement | null
    if (contentEl) resizeObs.observe(contentEl)
    else resizeObs.observe(el)
  }

  const onWheel = () => markUserIntent()
  const onTouchStart = () => markUserIntent()
  const onKeyDown = (e: KeyboardEvent) => {
    const intentKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]
    if (intentKeys.includes(e.key)) markUserIntent()
  }

  el.addEventListener("scroll", onScroll, { passive: true })
  el.addEventListener("wheel", onWheel, { passive: true })
  el.addEventListener("touchstart", onTouchStart, { passive: true })
  el.addEventListener("keydown", onKeyDown, { passive: true })

  return () => {
    resizeObs?.disconnect()
    resizeObs = null
    el.removeEventListener("scroll", onScroll)
    el.removeEventListener("wheel", onWheel)
    el.removeEventListener("touchstart", onTouchStart)
    el.removeEventListener("keydown", onKeyDown)
  }
})

$effect(() => {
  const count = live.transcript.length
  const last = live.transcript.at(-1)
  const lastLen = last?.text.length ?? 0
  void count
  void lastLen

  const timer = setTimeout(() => {
    maybeJump()
  }, 320)

  return () => clearTimeout(timer)
})
</script>

<!--
  F3: this renders off `voiceMode.ear`, and that is the point.

  The FSM split added `ear`/`mouth` with **zero production consumers**, which is
  the very pathology that got the mutation gate moved off `state` in the first
  place. A split nothing reads is theory: the axis cannot be observed, and a
  mutation on it cannot redden anything except assertions written beside it.

  Keying the surface on `ear` is what makes the split real — and it is also what
  gives DoD 7 something that can actually fail.
-->
{#if voiceMode.ear !== "closed"}
  <div
    class="w-full max-w-lg flex flex-col gap-2 text-sm rounded-xl p-3"
    style="background:var(--bg-card); border:1px solid var(--border)"
    aria-live="polite"
  >
    {#if live.transcript.length === 0}
      <span class="text-xs" style="color:var(--fg-dim)">{t("live.ear.listening")}</span>
    {/if}
    <div
      bind:this={scrollEl}
      class="flex flex-col"
      data-live-scroll
      style="max-height: 12rem; overflow-y: auto"
      tabindex="-1"
    >
      <div class="flex flex-col gap-2">
        {#each live.transcript as entry (entry.id)}
          <div class="flex flex-col gap-0.5" data-live-entry>
            <span class="text-xs font-semibold" style="color:var(--fg-dim)">
              {t(entry.role === "user" ? "live.transcript.user" : "live.transcript.assistant")}
            </span>
            <span style="color:var(--fg)" class:opacity-70={!entry.final}>{entry.text}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
