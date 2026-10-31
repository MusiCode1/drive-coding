import type { Patch } from "@drive-coding/core/session"
import type { SessionView } from "../session-view"
import { createProjectionRecorder } from "../session-view-delivery"
export class ProjectionRecorder {
  readonly batches: Patch[][] = []
  totalPushed = 0
  #waiters: (() => void)[] = []
  constructor(view: SessionView) {
    view.bindProjection(
      createProjectionRecorder((frame) => {
        if (frame.patches.length === 0) return
        this.batches.push(frame.patches)
        this.totalPushed++
        for (const wake of this.#waiters.splice(0)) wake()
      }),
    )
  }
  async nextPatches(n: number): Promise<Patch[][]> {
    while (this.batches.length < n) await new Promise<void>((r) => this.#waiters.push(r))
    return this.batches.splice(0, n)
  }
  async waitForTotalAtLeast(n: number): Promise<void> {
    while (this.totalPushed < n) await new Promise<void>((r) => this.#waiters.push(r))
  }
  async dispose(): Promise<void> {}
}
