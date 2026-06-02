/**
 * vad.ts — Silero VAD state + step.
 *
 * מקביל ל-createVadState + runVad ב-POC (wake-word-lib.js:134,146).
 * ort מועבר כפרמטר (אין global).
 */

import type * as OrtType from "onnxruntime-web"
import { SAMPLE_RATE } from "./audio-math.js"

export type OrtRef = Pick<typeof OrtType, "Tensor">
export type OrtSession = OrtType.InferenceSession
export type OrtTensor = OrtType.Tensor

/** מצב רקורנטי של Silero VAD ({h, c} tensors). */
export interface VadState {
  h: OrtTensor
  c: OrtTensor
}

/** יוצר state ריק עבור Silero VAD. */
export function createVadState(ortRef: OrtRef): VadState {
  const shape = [2, 1, 64]
  return {
    h: new ortRef.Tensor("float32", new Float32Array(128).fill(0), shape),
    c: new ortRef.Tensor("float32", new Float32Array(128).fill(0), shape),
  }
}

/**
 * מריץ צעד VAD אחד. Mutates state (h/c) in place.
 * מחזיר הסתברות דיבור 0..1.
 */
export async function runVadStep(
  vadModel: OrtSession,
  frame: Float32Array,
  state: VadState,
  ortRef: OrtRef,
): Promise<number> {
  const tensor = new ortRef.Tensor("float32", frame, [1, frame.length])
  const sr = new ortRef.Tensor("int64", [BigInt(SAMPLE_RATE)], [])
  const res = await vadModel.run({ input: tensor, sr, h: state.h, c: state.c })
  const output = res["output"]
  const hn = res["hn"]
  const cn = res["cn"]
  if (hn) state.h = hn
  if (cn) state.c = cn
  return (output?.data as Float32Array)[0] ?? 0
}
