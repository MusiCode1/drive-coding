/**
 * pipeline.ts — stateful score pipeline (mel→embedding→classifiers).
 *
 * מקביל ל-inferWindowSize + createScorePipeline ב-POC (wake-word-lib.js:186,218).
 * הלקח הקריטי: window-size שונה לכל classifier — חייב הסקה, לא קבוע.
 * mel buffer=76, hop=8 (AHA #2/#3).
 * ort מועבר כפרמטר (אין global).
 */

import type * as OrtType from "onnxruntime-web"
import { transformMel } from "./audio-math.js"

export type OrtRef = Pick<typeof OrtType, "Tensor">
export type OrtSession = OrtType.InferenceSession

/**
 * מסיק את גודל חלון ה-embedding מה-inputMetadata של classifier.
 * classifier sessions שונים עשויים לקבל N שונה (16/22/34).
 */
export function inferWindowSize(session: OrtSession, fallback = 16): number {
  const inName = session.inputNames?.[0]
  const md = (session as unknown as { inputMetadata?: unknown }).inputMetadata
  if (!md || !inName) return fallback
  const meta =
    Array.isArray(md)
      ? (md as Array<{ name?: string; shape?: number[] } | undefined>).find(
          (m) => m?.name === inName,
        ) ?? md[0]
      : (md as Record<string, { shape?: number[] }>)[inName]
  const dim = (meta as { shape?: number[] } | undefined)?.shape?.[1]
  return typeof dim === "number" && Number.isFinite(dim) ? dim : fallback
}

export interface ScorePipeline {
  windows: Record<string, number>
  reset(): void
  push(frame: Float32Array): Promise<Record<string, number> | null>
}

/**
 * בונה pipeline סטטי שממיר frames ל-scores per keyword.
 * מנהל mel buffer (76) ו-embedding history (max-window) פנימית.
 */
export function createScorePipeline({
  melModel,
  embModel,
  classifiers,
  ortRef,
}: {
  melModel: OrtSession
  embModel: OrtSession
  classifiers: Record<string, OrtSession>
  ortRef: OrtRef
}): ScorePipeline {
  // חישוב window size לכל classifier
  const windows: Record<string, number> = {}
  let maxWindow = 16
  for (const name in classifiers) {
    const w = inferWindowSize(classifiers[name] as OrtSession)
    windows[name] = w
    if (w > maxWindow) maxWindow = w
  }

  let melBuffer: Float32Array[] = []
  let embBuffer: Float32Array[] = []

  function initEmb() {
    embBuffer = []
    for (let i = 0; i < maxWindow; i++) embBuffer.push(new Float32Array(96).fill(0))
  }
  initEmb()

  async function runMelspec(frame: Float32Array): Promise<Float32Array[]> {
    const tensor = new ortRef.Tensor("float32", frame, [1, frame.length])
    const out = await melModel.run({ [melModel.inputNames[0] ?? "input"]: tensor })
    const data = out[melModel.outputNames[0] ?? "output"]?.data as Float32Array
    // in-place transform (AHA #1)
    transformMel(data)
    // מחלק ל-5 rows של 32 (ONNX עשוי לשתף buffer — מעתיק)
    const rows: Float32Array[] = []
    for (let j = 0; j < 5; j++) {
      rows.push(new Float32Array((data as Float32Array).subarray(j * 32, (j + 1) * 32)))
    }
    return rows
  }

  async function runEmbedding(melWindow76: Float32Array[]): Promise<Float32Array> {
    const flat = new Float32Array(76 * 32)
    for (let j = 0; j < melWindow76.length; j++) {
      flat.set(melWindow76[j] as Float32Array, j * 32)
    }
    const feeds = {
      [embModel.inputNames[0] ?? "input"]: new ortRef.Tensor("float32", flat, [1, 76, 32, 1]),
    }
    const out = await embModel.run(feeds)
    return new Float32Array(
      (out[embModel.outputNames[0] ?? "embedding"]?.data as Float32Array),
    )
  }

  async function runClassifier(
    clsModel: OrtSession,
    windowSize: number,
  ): Promise<number> {
    const win = embBuffer.slice(-windowSize)
    const flat = new Float32Array(windowSize * 96)
    for (let j = 0; j < win.length; j++) {
      flat.set(win[j] as Float32Array, j * 96)
    }
    const t = new ortRef.Tensor("float32", flat, [1, windowSize, 96])
    const out = await clsModel.run({ [clsModel.inputNames[0] ?? "embedding"]: t })
    return (out[clsModel.outputNames[0] ?? "score"]?.data as Float32Array)[0] ?? 0
  }

  return {
    windows,
    reset() {
      melBuffer = []
      initEmb()
    },
    async push(frame: Float32Array): Promise<Record<string, number> | null> {
      const rows = await runMelspec(frame)
      for (const r of rows) melBuffer.push(r)

      let latest: Record<string, number> | null = null

      // hop=8: כל פעם שיש 76 rows, מריצים embedding ומזיזים ב-8
      while (melBuffer.length >= 76) {
        const window = melBuffer.slice(0, 76)
        const emb = await runEmbedding(window)
        embBuffer.shift()
        embBuffer.push(emb)

        latest = {}
        for (const name in classifiers) {
          const w = windows[name] ?? 16
          latest[name] = await runClassifier(classifiers[name] as OrtSession, w)
        }
        melBuffer.splice(0, 8)
      }

      return latest
    },
  }
}
