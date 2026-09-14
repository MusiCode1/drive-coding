/**
 * live-log.ts — יומן Gemini Live לקונסול (slice live-silence-cost).
 *
 * למה: חיבור פתוח בלי מענה הוא אבחון עיוור — אין לדעת אם המיקרופון
 * שולח, אם ה-VAD זורק פריימים, או אם Gemini מחזיר משהו. `[live]` נותן
 * grep אחד בקונסול; `__dc.live()` שומר את ההיסטוריה אחרי ניווט.
 *
 * נפח: מעברים מיד (דיבור / מצב / אירוע נכנס). סיכום-מיקרופון לכל היותר
 * פעם בשנייה, לא כל פריים (~12.5 Hz).
 *
 * בפריוויו הרשומות גם נשלחות ל-BE (`fe.live` → `client.fe.live`).
 */

import { createLogger } from "../log"

const TAG = "[live]"
const log = createLogger("fe.live")

export type LiveLogEvent = {
  t: number
  level: "info" | "warn"
  event: string
  detail: string
}

export type LiveSnapshot = {
  state: string
  paused: boolean
  vadLoaded: boolean | null
  failOpen: boolean
  speaking: boolean
  lastProb: number | null
  lastRms: number | null
  framesIn: number
  framesSent: number
  framesDropped: number
  inbound: {
    sessionStarted: boolean
    transcripts: number
    audioChunks: number
    audioBytes: number
    actions: number
    lastType: string | null
    lastAgoMs: number | null
  }
  lastMicAgoMs: number | null
  lastSendAgoMs: number | null
}

const RING_MAX = 200
const HEARTBEAT_MS = 1000
const ring: LiveLogEvent[] = []

const snap: LiveSnapshot = emptySnapshot()

let lastMicLogAt = 0
let lastAudioLogAt = 0
let lastEmptyGeminiAt = 0
let lastInboundAt: number | null = null
let lastMicAt: number | null = null
let lastSendAt: number | null = null
let prevSpeaking = false

function emptySnapshot(): LiveSnapshot {
  return {
    state: "closed",
    paused: false,
    vadLoaded: null,
    failOpen: false,
    speaking: false,
    lastProb: null,
    lastRms: null,
    framesIn: 0,
    framesSent: 0,
    framesDropped: 0,
    inbound: {
      sessionStarted: false,
      transcripts: 0,
      audioChunks: 0,
      audioBytes: 0,
      actions: 0,
      lastType: null,
      lastAgoMs: null,
    },
    lastMicAgoMs: null,
    lastSendAgoMs: null,
  }
}

function push(level: "info" | "warn", event: string, detail: string): void {
  ring.push({ t: Date.now(), level, event, detail })
  if (ring.length > RING_MAX) ring.shift()
}

function fmt(detail?: Record<string, unknown>): string {
  if (!detail) return ""
  return Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "number" ? formatNum(v) : String(v)}`)
    .join(" ")
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n) || Math.abs(n) >= 10) return String(Math.round(n * 1000) / 1000)
  return n.toFixed(3)
}

function ages(now: number): void {
  snap.lastMicAgoMs = lastMicAt === null ? null : now - lastMicAt
  snap.lastSendAgoMs = lastSendAt === null ? null : now - lastSendAt
  snap.inbound.lastAgoMs = lastInboundAt === null ? null : now - lastInboundAt
}

/** האירועים האחרונים, החדש בסוף. תמונת-מצב — לא הרפרנס. */
export function liveEvents(): LiveLogEvent[] {
  return [...ring]
}

/** תמונת-מצב שטוחה לאבחון `__dc.live()`. */
export function liveSnapshot(): LiveSnapshot {
  ages(Date.now())
  return {
    ...snap,
    inbound: { ...snap.inbound },
  }
}

/** מעבר תקין — חיבור, דיבור, תשובה. */
export function liveInfo(event: string, detail?: Record<string, unknown>): void {
  const d = fmt(detail)
  push("info", event, d)
  console.info(`${TAG} ${event}`, d || detail || "")
  log.info(detail ?? {}, event)
}

/** כשל או fail-open — מה שהמשתמש עלול לא לראות על המסך. */
export function liveWarn(event: string, detail?: Record<string, unknown>): void {
  const d = fmt(detail)
  push("warn", event, d)
  console.warn(`${TAG} ${event}`, d || detail || "")
  log.warn(detail ?? {}, event)
}

export function liveResetCounters(): void {
  snap.framesIn = 0
  snap.framesSent = 0
  snap.framesDropped = 0
  snap.speaking = false
  snap.lastProb = null
  snap.lastRms = null
  snap.inbound = {
    sessionStarted: false,
    transcripts: 0,
    audioChunks: 0,
    audioBytes: 0,
    actions: 0,
    lastType: null,
    lastAgoMs: null,
  }
  lastMicLogAt = 0
  lastAudioLogAt = 0
  lastEmptyGeminiAt = 0
  lastInboundAt = null
  lastMicAt = null
  lastSendAt = null
  prevSpeaking = false
}

export function liveSetState(state: string): void {
  snap.state = state
  liveInfo("state", { state, paused: snap.paused, failOpen: snap.failOpen })
}

export function liveSetPaused(paused: boolean): void {
  snap.paused = paused
  liveInfo(paused ? "paused" : "resumed")
}

export function liveSetVadLoaded(ok: boolean): void {
  snap.vadLoaded = ok
  if (ok) {
    snap.failOpen = false
    liveInfo("vad-loaded")
  } else {
    snap.failOpen = true
    liveWarn("vad-load-failed")
  }
}

export function liveSetFailOpen(reason: string): void {
  if (snap.failOpen) return
  snap.failOpen = true
  liveWarn("vad-fail-open", { reason })
}

/** RMS של פריים Float32 — זול מספיק לכל פריים 80ms. */
export function frameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0
  let s = 0
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] ?? 0
    s += v * v
  }
  return Math.sqrt(s / frame.length)
}

/**
 * דגימת-מיקרופון אחרי שערי-הדיבור. לוג מיידי במעבר דיבור;
 * אחרת לכל היותר פעם בשנייה.
 */
export function liveNoteMic(opts: {
  prob: number | null
  speaking: boolean
  sent: number
  rms: number
  failOpen: boolean
}): void {
  const now = Date.now()
  lastMicAt = now
  snap.framesIn += 1
  snap.framesSent += opts.sent
  snap.framesDropped += opts.sent > 0 ? 0 : 1
  snap.lastProb = opts.prob
  snap.lastRms = opts.rms
  snap.speaking = opts.speaking
  if (opts.failOpen) snap.failOpen = true
  if (opts.sent > 0) lastSendAt = now

  const edge = opts.speaking !== prevSpeaking
  prevSpeaking = opts.speaking
  if (edge) {
    liveInfo(opts.speaking ? "speech-start" : "speech-stop", {
      p: opts.prob,
      rms: opts.rms,
      sent: opts.sent,
      in: snap.framesIn,
      out: snap.framesSent,
      drop: snap.framesDropped,
      failOpen: snap.failOpen,
    })
    lastMicLogAt = now
    return
  }

  if (now - lastMicLogAt < HEARTBEAT_MS) return
  lastMicLogAt = now
  liveInfo("mic", {
    p: opts.prob,
    rms: opts.rms,
    speaking: opts.speaking,
    in: snap.framesIn,
    out: snap.framesSent,
    drop: snap.framesDropped,
    paused: snap.paused,
    failOpen: snap.failOpen,
  })
}

export function liveNotePausedFrame(): void {
  snap.framesIn += 1
  lastMicAt = Date.now()
}

export function liveNoteInbound(event: string, detail?: Record<string, unknown>): void {
  const now = Date.now()
  lastInboundAt = now
  snap.inbound.lastType = event
  liveInfo(event, detail)
}

export function liveNoteSessionStarted(): void {
  snap.inbound.sessionStarted = true
  liveNoteInbound("session_started")
}

export function liveNoteTranscript(role: string, text: string, final: boolean): void {
  snap.inbound.transcripts += 1
  const clipped = text.length > 80 ? `${text.slice(0, 80)}…` : text
  liveNoteInbound("transcript", { role, final, n: text.length, text: clipped })
}

export function liveNoteAudioOut(bytes: number): void {
  snap.inbound.audioChunks += 1
  snap.inbound.audioBytes += bytes
  const now = Date.now()
  lastInboundAt = now
  snap.inbound.lastType = "audio"
  if (snap.inbound.audioChunks === 1 || now - lastAudioLogAt >= HEARTBEAT_MS) {
    lastAudioLogAt = now
    liveInfo("audio-out", {
      bytes,
      chunks: snap.inbound.audioChunks,
      total: snap.inbound.audioBytes,
    })
  }
}

export function liveNoteAction(name: string, id: string): void {
  snap.inbound.actions += 1
  liveNoteInbound("action", { name, id })
}

/** Gemini frame that mapped to zero LiveEvents — keepalive or unknown. */
export function liveNoteEmptyGemini(keys: string[], extra?: Record<string, unknown>): void {
  const now = Date.now()
  lastInboundAt = now
  snap.inbound.lastType = "gemini-empty"
  if (now - lastEmptyGeminiAt < HEARTBEAT_MS) return
  lastEmptyGeminiAt = now
  liveInfo("gemini-empty", { keys: keys.join(",") || "(none)", ...extra })
}

/** לטסטים בלבד — מרוקן את החוצץ ואת המונים. */
export function resetLiveLogForTests(): void {
  ring.length = 0
  Object.assign(snap, emptySnapshot())
  liveResetCounters()
}
