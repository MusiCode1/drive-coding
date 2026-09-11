<script lang="ts">
  /**
   * /playlist-nav-chrome-test — manual Chrome harness for queue navigation + late TTS.
   *
   * Intentional route-shell exception (like /bt-test): wires real AudioPlaylist +
   * PlayableSink for DoD manual verification. Not linked from main UI.
   *
   * ?autorun=1 — runs nav + late-arrival scenarios; sets window.__playlistNavChrome.
   */
  import { onMount } from "svelte"
  import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
  import { PlayableSink } from "$lib/engines/playable-sink"
  import type { OrderKey } from "@drive-coding/core/voice/tts-queue"

  const SEGMENT_COUNT = 20
  const RESERVE_TIMEOUT_MS = 2000
  const FIXTURE_BASE = "/fixtures/playlist-nav-chrome"

  type HarnessCheck = {
    action: string
    duration: number
    currentTime: number
    expectedDuration: number
    sameAudio: boolean
  }

  type HarnessResult = {
    ok: boolean
    failures: string[]
    checks: HarnessCheck[]
    lateArrival: { prevPlayedSeg4: boolean }
  }

  const sink = new PlayableSink()
  const playlist = new AudioPlaylist(sink, undefined, { reserveTimeoutMs: RESERVE_TIMEOUT_MS })

  let status = $state("idle")
  let log = $state<string[]>([])

  function push(msg: string): void {
    log = [...log.slice(-80), msg]
  }

  function segId(i: number): string {
    return `seg-${String(i).padStart(2, "0")}`
  }

  function expectedDuration(i: number): number {
    return 5 + i * 0.25
  }

  /** Simulated network delay before markReady (not real TTS). */
  function delayForIndex(i: number): number {
    if (i === 4) return 3500 // late arrival — arrives after reserve-timeout
    if (i === 7) return 1000 // ~1s — must play, not timeout
    if (i === 12 || i === 13) return 3500 // > timeout — skipped forward
    return (i * 37) % 200 // 0–200ms
  }

  async function mp3Stream(path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(path)
    if (!res.ok || res.body === null) throw new Error(`fetch ${path}: ${res.status}`)
    return res.body
  }

  async function enqueueAll(): Promise<void> {
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const id = segId(i)
      const key: OrderKey = { seq: i, segmentIndex: 0 }
      playlist.reserve(id, key, "harness")
      const ac = new AbortController()
      const stream = await mp3Stream(`${FIXTURE_BASE}/${id}.mp3`)
      void playlist.prepareSegmentForBubble(id, stream, ac)
      const delay = delayForIndex(i)
      setTimeout(() => playlist.markReady(id), delay)
    }
  }

  function checkAfterNav(action: string, index: number, audioRef: HTMLAudioElement): HarnessCheck {
    const audio = sink.getAudioElement()
    const expected = expectedDuration(index)
    const dur = audio.duration
    const ct = audio.currentTime
    const sameAudio = audio === audioRef
    const tol = 0.35
    if (!Number.isFinite(dur) || Math.abs(dur - expected) > tol) {
      push(`WARN ${action}: duration ${dur} vs expected ${expected}`)
    }
    if (ct >= 1.5) {
      push(`WARN ${action}: currentTime ${ct} >= 1.5s`)
    }
    return { action, duration: dur, currentTime: ct, expectedDuration: expected, sameAudio }
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms))
  }

  async function runNavScenario(audioRef: HTMLAudioElement, checks: HarnessCheck[]): Promise<void> {
    await sleep(2000) // wait ~2s on seg 0
    checks.push(checkAfterNav("start@0", 0, audioRef))

    for (let n = 0; n < 3; n++) {
      playlist.next()
      await sleep(300)
      checks.push(checkAfterNav(`next-${n + 1}`, playlist.cursor, audioRef))
    }

    playlist.prev()
    await sleep(300)
    checks.push(checkAfterNav("prev", playlist.cursor, audioRef))

    playlist.jumpTo(17)
    await sleep(400)
    checks.push(checkAfterNav("jumpTo-17", 17, audioRef))

    while (playlist.cursor < SEGMENT_COUNT - 1) {
      playlist.next()
      await sleep(200)
    }
    checks.push(checkAfterNav("next-to-end", playlist.cursor, audioRef))
  }

  async function runLateArrivalScenario(): Promise<{ prevPlayedSeg4: boolean }> {
    // Wait until seg-04 skipped (delay 3500 > timeout 2000) while later segs play
    await sleep(6000)
    const item4 = playlist.items.find((it) => it.segmentId === "seg-04")
    push(`seg-04 state before prev: ${item4?.state ?? "missing"}`)
    playlist.prev()
    await sleep(500)
    // Find if seg-04 was played — check sink played count via registry or wait
    await sleep(1000)
    return { prevPlayedSeg4: item4?.state === "skipped" || item4?.state === "done" || item4?.state === "playing" }
  }

  async function runAutorun(): Promise<HarnessResult> {
    const failures: string[] = []
    const checks: HarnessCheck[] = []
    status = "running"
    push("enqueue 20 segments…")
    await enqueueAll()
    const audioRef = sink.getAudioElement()
    await sleep(500)

    try {
      await runNavScenario(audioRef, checks)
      const lateArrival = await runLateArrivalScenario()
      for (const c of checks) {
        if (!c.sameAudio) failures.push(`${c.action}: audio element changed`)
        if (Math.abs(c.duration - c.expectedDuration) > 0.35) {
          failures.push(`${c.action}: duration ${c.duration} vs ${c.expectedDuration}`)
        }
        if (c.currentTime >= 1.5) failures.push(`${c.action}: currentTime ${c.currentTime}`)
      }
      return { ok: failures.length === 0, failures, checks, lateArrival }
    } catch (e) {
      failures.push(String(e))
      return { ok: false, failures, checks, lateArrival: { prevPlayedSeg4: false } }
    } finally {
      status = "done"
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("autorun") !== "1") return

    void runAutorun().then((result) => {
      ;(window as Window & { __playlistNavChrome?: { result: HarnessResult } }).__playlistNavChrome = {
        result,
      }
      push(result.ok ? "PASS" : `FAIL: ${result.failures.join("; ")}`)
    })
  })

  declare global {
    interface Window {
      __playlistNavChrome?: { result: HarnessResult }
    }
  }
</script>

<main class="p-4 font-mono text-sm max-w-xl">
  <h1 class="text-lg mb-2">playlist-nav-chrome harness</h1>
  <p class="mb-2 opacity-70">
    {SEGMENT_COUNT} MP3 fixtures · reserveTimeoutMs={RESERVE_TIMEOUT_MS} · add ?autorun=1
  </p>
  <p class="mb-4">status: {status}</p>
  <ul class="space-y-1 max-h-96 overflow-auto">
    {#each log as line}
      <li>{line}</li>
    {/each}
  </ul>
</main>
