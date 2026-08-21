/**
 * rec-probe.test.ts — ‏נועל את מכונת-המצבים שנשברה על חומרה אמיתית.
 *
 * ‏הלוג הראה 3 ‏`started` ‏רצופות ואז 8 ‏`stopped` ‏על הקלטה אחת, ‏עם `ms` ‏שגדל
 * ‏מונוטונית מאותה חותמת. ‏כל טסט כאן מכוון לאחד השערים שהיו חסרים.
 */
import { describe, expect, it, vi } from "vitest"
import { type RecorderLike, RecProbe, type RecProbeCue, type RecProbeRow } from "./rec-probe.js"

/** ‏שעון-מונה. ‏🔴 ‏חייב **‏להתקדם** — ‏עם שעון קבוע מוטציות H ‏ו-I ‏שורדות. */
function makeClock(step = 100) {
  let t = 1000
  return () => {
    t += step
    return t
  }
}

type Spy = RecorderLike & { startCalls: number; stopCalls: number }

function makeHarness(opts: { bytes?: number; startThrows?: boolean } = {}) {
  const rows: RecProbeRow[] = []
  const cues: RecProbeCue[] = []
  // ⚠️ ‏משתנה מוטיפס, ‏לא אובייקט-ליטרל טרי ב-constructor — ‏אחרת TS2353.
  const recorder: Spy = {
    startCalls: 0,
    stopCalls: 0,
    async start() {
      this.startCalls++
      if (opts.startThrows) throw new Error("mic denied")
    },
    async stop() {
      this.stopCalls++
      return { blob: { size: opts.bytes ?? 4096 }, mimeType: "audio/webm;codecs=opus" }
    },
  }
  const probe = new RecProbe({
    recorder,
    now: makeClock(),
    onRow: (r) => rows.push(r),
    onCue: (c) => cues.push(c),
    onStartFailed: vi.fn(),
  })
  const detailsOf = (d: string) => rows.filter((r) => r.detail.startsWith(d))
  return { probe, rows, cues, recorder, detailsOf }
}

describe("rec-probe", () => {
  it("start,start,stop,stop yields one started, one stopped, and two rejections", async () => {
    const h = makeHarness()
    await h.probe.handle("next")
    await h.probe.handle("next")
    await h.probe.handle("prev")
    await h.probe.handle("prev")

    expect(h.detailsOf("recording started")).toHaveLength(1)
    expect(h.detailsOf("recording stopped")).toHaveLength(1)
    expect(h.detailsOf("start ignored")).toHaveLength(1)
    expect(h.detailsOf("stop ignored")).toHaveLength(1)
    expect(h.recorder.startCalls).toBe(1)
    expect(h.recorder.stopCalls).toBe(1)
  })

  it("two overlapping starts — the second is rejected and the recorder is called once", async () => {
    // 🔴 ‏**‏חפיפה**, ‏בלי await ‏ביניהן. ‏בקריאות סדרתיות המוטציה שורדת.
    const h = makeHarness()
    const a = h.probe.handle("next")
    const b = h.probe.handle("next")
    await Promise.all([a, b])

    expect(h.recorder.startCalls).toBe(1)
    expect(h.detailsOf("recording started")).toHaveLength(1)
    expect(h.detailsOf("start ignored")).toHaveLength(1)
  })

  it("a stop on a fresh probe is rejected, not forwarded", async () => {
    // ‏זהו המסלול שהחזיר `bytes:0` + `audio/webm` ‏שבע פעמים בלוג.
    const h = makeHarness()
    await h.probe.handle("prev")
    expect(h.recorder.stopCalls).toBe(0)
    expect(h.detailsOf("stop ignored")).toHaveLength(1)
    expect(h.detailsOf("recording stopped")).toHaveLength(0)
  })

  it("after a full cycle, a further stop reports elapsedMs 0", async () => {
    const h = makeHarness()
    await h.probe.handle("next")
    await h.probe.handle("prev")
    await h.probe.handle("prev")

    const rejected = h.detailsOf("stop ignored")
    expect(rejected).toHaveLength(1)
    // ‏בלי איפוס-החותמת זה היה מספר **‏גדל** — ‏החתימה המונוטונית שבלוג.
    expect(rejected[0]?.data?.elapsedMs).toBe(0)
  })

  it("center never starts or stops a recording", async () => {
    const h = makeHarness()
    await h.probe.handle("center")
    await h.probe.handle("next")
    await h.probe.handle("center")

    expect(h.recorder.startCalls).toBe(1)
    expect(h.recorder.stopCalls).toBe(0)
    expect(h.probe.state).toBe("recording")
    expect(h.rows.filter((r) => r.detail.includes("ignored"))).toHaveLength(0)
  })

  it("stopped row carries bytesPerSec", async () => {
    const h = makeHarness({ bytes: 4096 })
    await h.probe.handle("next")
    await h.probe.handle("prev")

    const stopped = h.detailsOf("recording stopped")[0]
    const ms = stopped?.data?.ms as number
    expect(ms).toBeGreaterThan(0)
    expect(stopped?.data?.bytesPerSec).toBe(Math.round(4096 / (ms / 1000)))
  })

  it("both cues fire — recordingStart on start, recordingStop on stop", async () => {
    const h = makeHarness()
    await h.probe.handle("next")
    expect(h.cues).toEqual(["recordingStart"])
    await h.probe.handle("prev")
    expect(h.cues).toEqual(["recordingStart", "recordingStop"])
  })

  it("a failed start leaves the probe idle and reports it", async () => {
    const h = makeHarness({ startThrows: true })
    await h.probe.handle("next")
    expect(h.probe.state).toBe("idle")
    expect(h.rows.some((r) => r.kind === "err")).toBe(true)
    // ‏ו-`prev` ‏שאחריו נדחה, ‏לא מועבר ל-recorder המת
    await h.probe.handle("prev")
    expect(h.recorder.stopCalls).toBe(0)
  })
})
