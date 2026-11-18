/**
 * pending-capture-wiring.ts — layout wiring for shared pending-capture store.
 * (slice voice-pending-persistence)
 */
import { createPendingCaptureStore } from "../adapters/pending-capture-store"
import { PendingCaptureRecovery } from "./pending-capture-recovery"
import type { MicPendingRecovery } from "../view-models/mic.svelte"

export function createPendingCaptureWiring(): {
  micRecovery: MicPendingRecovery
  dictateRecovery: PendingCaptureRecovery
} {
  const store = createPendingCaptureStore()
  return {
    micRecovery: new PendingCaptureRecovery(store, {
      source: "mic",
      transcribeErrorKey: "mic.error.transcribe",
    }),
    dictateRecovery: new PendingCaptureRecovery(store, {
      source: "dictate",
      transcribeErrorKey: "dictate.error.transcribe",
    }),
  }
}
