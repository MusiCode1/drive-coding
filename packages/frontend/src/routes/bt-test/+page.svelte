<script lang="ts">
  /**
   * /bt-test — route אבחון standalone לשלט Bluetooth (D-pad).
   *
   * 🔴 חריגה מכוונת מחוק-זהב #1 (`packages/frontend/AGENTS.md`), ב-**שלושה**
   * סעיפים נפרדים: (א) מאזיני `window`/`document` · (ב) polling (`setInterval`
   * ל-tick ול-watchdog) · (ג) חריגה מתקציב 150 השורות.
   *
   * למה: **זה תנאי-הבדיקוּת** של הסלייס. הליבה (`engines/bt-remote.ts`) חייבת
   * להישאר טהורה ומוזרקת-אירועים כדי שתהיה בת-בדיקה ב-vitest בלי דפדפן, ולכן
   * החיווט חייב לחיות **מחוצה לה**. ה-state מת עם ה-route.
   *
   * ⚠️ התקדים `/wake-word-test` מתעד חריגה **צרה יותר** — הוא יוצר VM בעצמו,
   * אך אינו רושם מאזינים ואינו עושה polling. החריגה כאן רחבה ממנו, ולכן
   * מתועדת כאן בשלושת סעיפיה במפורש.
   *
   * Consumer: רק route זה. אינו מקושר מה-UI — כתובת ישירה בלבד.
   */
  import { onMount } from "svelte"
  import BtLog, { type BtLogRow } from "$lib/components/bt-test/BtLog.svelte"
  import BtPad from "$lib/components/bt-test/BtPad.svelte"
  import {
    BtRemoteEngine,
    buttonForKeyCode,
    BURST_GAP_MS,
    CROSS_CHANNEL_DEDUP_MS,
    HOLD_THRESHOLD_MS,
    PREHOLD_ABSORB_MS,
    PREHOLD_TIMEOUT_MS,
    TICK_INTERVAL_MS,
    type BtButton,
    type BtCommand,
    type BtStats,
  } from "$lib/engines/bt-remote.js"
  import {
    BEAT_INTERVAL_MS,
    LOOP_AMPLITUDE,
    LOOP_SAMPLE_RATE,
    LOOP_SECONDS,
    makeNoiseWav,
    MediaSessionKeepalive,
    WATCHDOG_INTERVAL_MS,
  } from "$lib/engines/media-session-keepalive.js"
  import { CuesEngine } from "$lib/engines/cues.js"
  import { Recorder } from "$lib/engines/recorder.js"
  import { RecProbe } from "$lib/engines/rec-probe.js"
  import { WakeLockEngine } from "$lib/engines/wake-lock.js"

  const LOG_CAP = 2000
  const pageStart = performance.now()
  const hasMediaRecorder = typeof MediaRecorder !== "undefined"

  type BtExport = {
    schema: "bt-remote-log/1"
    exportedAt: string
    userAgent: string
    armedAt: number | null
    durationMs: number
    constants: Record<string, number>
    stats: BtStats & { rows: number; truncated: boolean }
    rows: BtLogRow[]
  }

  const engine = new BtRemoteEngine()
  let rows = $state<BtLogRow[]>([])
  let rowSeq = 0
  let truncated = $state(false)
  let armed = $state(false)
  let arming = $state(false)
  let armedAt = $state<number | null>(null)
  let hot = $state<BtButton | null>(null)
  let flash = $state<BtButton | null>(null)
  let holdingMs = $state(0)
  let audioEl: HTMLAudioElement | null = null
  let keepalive: MediaSessionKeepalive | null = null
  let objectUrl: string | null = null
  let recordProbe = $state(false)
  let wakeOn = $state(false)
  let audioPlaying = $state(false)
  let cmdCount = $state(0)
  let suppressedCount = $state(0)
  const recorder = new Recorder()
  const cues = new CuesEngine()
  const wakeLock = new WakeLockEngine()

  const eventCount = $derived(rows.length)

  const vis = (): "visible" | "hidden" =>
    typeof document !== "undefined" && document.visibilityState === "hidden" ? "hidden" : "visible"
  const nowMs = () => Math.round(performance.now() - pageStart)

  // ⚠️ ‏חייב לשבת **‏אחרי** ‏`nowMs` — ‏הוא `const` ‏חץ, ‏ובנייה מעליו היא
  // ‏`ReferenceError` ‏ב-TDZ ‏בטעינת הדף. ‏אף שער קיים לא היה תופס את זה.
  const recProbe = new RecProbe({
    recorder,
    now: nowMs,
    onRow: (row) => pushRow(row),
    onStartFailed: () => {
      recordProbe = false
    },
    onCue: (cue) => cues.play(cue),
  })

  function pushRow(partial: Omit<BtLogRow, "id" | "t" | "visibility"> & { t?: number }) {
    rows = [{ id: ++rowSeq, t: partial.t ?? nowMs(), visibility: vis(), ...partial }, ...rows]
    if (rows.length > LOG_CAP) {
      rows = rows.slice(0, LOG_CAP)
      truncated = true
    }
  }

  function onCmd(cmd: BtCommand) {
    pushRow({
      kind: "cmd",
      detail: `${cmd.button} ${cmd.gesture} ${cmd.channel} hold=${cmd.holdMs}ms pulses=${cmd.pulses}`,
      data: { ...cmd },
    })
    flash = cmd.button
    setTimeout(() => {
      if (flash === cmd.button) flash = null
    }, 250)
    if (recordProbe) void recProbe.handle(cmd.button)
  }

  function setWake(on: boolean) {
    wakeOn = on
    wakeLock.setEnabled(on)
  }

  function ingestDown(code: string, at: number, sim = false) {
    pushRow({ kind: "raw-key", detail: `DOWN ${code}`, data: { code, type: "down" }, simulated: sim || undefined })
    const cmd = engine.ingestKey({ type: "down", code, at })
    if (cmd) onCmd(cmd)
  }

  function ingestUp(code: string, at: number, sim = false) {
    pushRow({ kind: "raw-key", detail: `UP ${code}`, data: { code, type: "up" }, simulated: sim || undefined })
    const cmd = engine.ingestKey({ type: "up", code, at })
    if (cmd) onCmd(cmd)
  }

  function ingestMedia(action: string, at: number, sim = false) {
    pushRow({ kind: "raw-media", detail: action, data: { action }, simulated: sim || undefined })
    const cmd = engine.ingestMediaAction(action, at)
    if (cmd) onCmd(cmd)
  }

  async function arm() {
    if (arming || armed) return
    arming = true
    try {
      const blob = makeNoiseWav(LOOP_SECONDS, LOOP_SAMPLE_RATE, LOOP_AMPLITUDE)
      objectUrl = URL.createObjectURL(blob)
      audioEl = new Audio(objectUrl)
      audioEl.loop = true
      await audioEl.play()
      keepalive = new MediaSessionKeepalive({ audio: audioEl, mediaSession: navigator.mediaSession ?? null, now: nowMs })
      const n = keepalive.registerActionHandlers((action, at) => ingestMedia(action, at))
      pushRow({ kind: "sys", detail: `armed — ${n} media handlers` })
      if (navigator.mediaSession) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: "BT Remote Test", artist: "drive-coding" })
        navigator.mediaSession.playbackState = "playing"
      }
      armed = true
      armedAt = nowMs()
      audioPlaying = true
    } catch (e: unknown) {
      pushRow({ kind: "err", detail: e instanceof Error ? e.message : String(e) })
    } finally {
      arming = false
    }
  }

  function buildExport(): BtExport {
    return {
      schema: "bt-remote-log/1",
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      armedAt,
      durationMs: nowMs(),
      constants: {
        burstGapMs: BURST_GAP_MS,
        holdThresholdMs: HOLD_THRESHOLD_MS,
        preholdAbsorbMs: PREHOLD_ABSORB_MS,
        preholdTimeoutMs: PREHOLD_TIMEOUT_MS,
        crossChannelDedupMs: CROSS_CHANNEL_DEDUP_MS,
        tickIntervalMs: TICK_INTERVAL_MS,
        watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
        beatIntervalMs: BEAT_INTERVAL_MS,
        loopSeconds: LOOP_SECONDS,
      },
      stats: { ...engine.stats, rows: rows.length, truncated },
      rows: [...rows].reverse(),
    }
  }

  function downloadLog() {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    const blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `bt-remote-${ts}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function simHoldCenter() {
    const t0 = nowMs()
    ingestDown("MediaPlayPause", t0, true)
    setTimeout(() => {
      ingestDown("MediaPlayPause", t0 + 400, true)
      for (let i = 0; i < 21; i++) ingestDown("MediaPlayPause", t0 + 450 + i * 50, true)
      ingestUp("MediaPlayPause", t0 + 1500, true)
    }, 400)
  }

  onMount(() => {
    const down = (e: KeyboardEvent) => {
      if (buttonForKeyCode(e.code)) e.preventDefault()
      ingestDown(e.code, nowMs())
    }
    const up = (e: KeyboardEvent) => {
      if (buttonForKeyCode(e.code)) e.preventDefault()
      ingestUp(e.code, nowMs())
    }
    const onVis = () => pushRow({ kind: "sys", detail: `visibility ${document.visibilityState}` })
    window.addEventListener("keydown", down, true)
    window.addEventListener("keyup", up, true)
    document.addEventListener("visibilitychange", onVis)
    const tickId = setInterval(() => {
      const n = nowMs()
      for (const cmd of engine.tick(n)) onCmd(cmd)
      const p = engine.pending(n)[0]
      hot = p?.button ?? null
      holdingMs = p?.elapsedMs ?? 0
      cmdCount = engine.stats.emitted
      suppressedCount = engine.stats.suppressedCrossChannel
    }, TICK_INTERVAL_MS)
    const pumpId = setInterval(() => {
      if (!keepalive) return
      void keepalive.pump(nowMs()).then((evts) => {
        for (const e of evts) {
          if (e.kind === "beat") {
            pushRow({ kind: "beat", detail: `beat paused=${e.paused} t=${e.currentTime.toFixed(1)}`, data: { ...e } })
          } else if (e.kind === "state-change") {
            audioPlaying = !e.paused
            pushRow({ kind: "audio", detail: `paused=${e.paused}` })
          } else if (e.kind === "resume-ok") {
            audioPlaying = true
            pushRow({ kind: "audio", detail: "resume ok" })
          } else {
            pushRow({ kind: "err", detail: `resume failed: ${e.error}` })
          }
        }
      })
    }, WATCHDOG_INTERVAL_MS)
    return () => {
      window.removeEventListener("keydown", down, true)
      window.removeEventListener("keyup", up, true)
      document.removeEventListener("visibilitychange", onVis)
      clearInterval(tickId)
      clearInterval(pumpId)
      keepalive?.dispose()
      wakeLock.dispose()
      audioEl?.pause()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  })
</script>

<svelte:head><title>BT Remote Test</title></svelte:head>
<main>
  <h1>Bluetooth D-pad Remote Test</h1>
  <div class="chips">
    <span class:ok={armed && audioPlaying}>Audio</span>
    <span class:ok={armed && typeof navigator !== "undefined" && !!navigator.mediaSession}>MediaSession</span>
    <span class:ok={wakeOn}>Screen</span>
    <span>Events {eventCount}</span>
    <span>Commands {cmdCount}</span>
    <span>Suppressed {suppressedCount}</span>
  </div>
  <p class="sub">Tap Arm once, then use the car remote. KEY channel is primary.</p>
  <button class="arm" disabled={armed || arming} onclick={arm}>
    {armed ? "Armed" : arming ? "Arming…" : "Arm — start audio loop"}
  </button>
  <div class="toggles">
    {#if hasMediaRecorder}
      <label><input type="checkbox" bind:checked={recordProbe} /> Record probe</label>
    {:else}
      <span class="sub">MediaRecorder API unavailable — probe disabled</span>
    {/if}
    <label><input type="checkbox" checked={wakeOn} onchange={(e) => setWake(e.currentTarget.checked)} /> Keep screen on</label>
  </div>
  <BtPad {hot} {flash} />
  <BtLog
    {rows}
    {holdingMs}
    onClear={() => (rows = [])}
    onCopy={() => void navigator.clipboard.writeText(JSON.stringify(buildExport(), null, 2))}
    onDownload={downloadLog}
    onSimTapNext={() => {
      const t = nowMs()
      ingestDown("MediaTrackNext", t, true)
      ingestUp("MediaTrackNext", t + 5, true)
    }}
    onSimHoldCenter={simHoldCenter}
    onSimMediaNext={() => ingestMedia("nexttrack", nowMs(), true)}
    onSimMediaPrev={() => ingestMedia("previoustrack", nowMs(), true)}
    onSimMediaPause={() => ingestMedia("pause", nowMs(), true)}
  />
</main>

<style>
  :global(html), :global(body) { height: auto !important; overflow-y: auto !important; }
  :global(body) { background: #0b0f14; color: #e6edf3; font-family: system-ui, sans-serif; }
  main { display: flex; flex-direction: column; align-items: center; gap: 0.8rem; padding: 1.2rem 1rem 2rem; max-width: 40rem; margin: 0 auto; width: 100%; }
  h1 { font-size: 1.1rem; margin: 0; }
  .sub { font-size: 0.78rem; color: #8899a8; margin: 0; text-align: center; }
  .arm { width: 100%; padding: 0.85rem; font-weight: 600; background: #7ee081; color: #0b0f14; border: 0; border-radius: 0.55rem; }
  .arm:disabled { background: #1c2530; color: #8899a8; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; justify-content: center; }
  .chips span { font-size: 0.68rem; padding: 0.15rem 0.45rem; border-radius: 999px; background: #1c2530; color: #8899a8; border: 1px solid #2a3644; }
  .chips span.ok { background: #7ee081; color: #0b0f14; border-color: #7ee081; font-weight: 600; }
  .toggles { display: flex; flex-wrap: wrap; gap: 0.8rem; font-size: 0.78rem; width: 100%; justify-content: center; }
  .toggles label { display: flex; align-items: center; gap: 0.35rem; cursor: pointer; }
</style>
