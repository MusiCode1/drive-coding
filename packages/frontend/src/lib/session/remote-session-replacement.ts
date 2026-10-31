import type { SessionState } from "@drive-coding/core/session"
import { projectSessionSnapshot } from "./session-view-projection"

type ReplacementIntent = {
  previous: ReplacementIntent | undefined
  state: "active" | "failed" | "consumed"
}

/** Imperative owner of replacement obligations not yet covered by a structural frame. */
export class RemoteSessionReplacement {
  #intent: ReplacementIntent | undefined

  capture(): ReplacementIntent | undefined {
    return this.#intent
  }

  consume(intent: ReplacementIntent | undefined): void {
    if (!intent) return
    intent.state = "consumed"
    // The barrier covers every older obligation; release that prefix.
    intent.previous = undefined
    if (this.#intent === intent) this.#intent = undefined
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const intent: ReplacementIntent = {
      previous: this.#intent,
      state: "active",
    }
    this.#intent = intent
    try {
      return await work()
    } catch (error) {
      // Consumed is terminal, including when a newer operation is current.
      if (intent.state === "active") {
        intent.state = "failed"
        if (this.#intent === intent) {
          this.#intent = this.#nearestActive(intent.previous)
        }
      }
      throw error
    }
  }

  #nearestActive(intent: ReplacementIntent | undefined): ReplacementIntent | undefined {
    let previous = intent
    while (previous?.state === "failed") previous = previous.previous
    return previous?.state === "active" ? previous : undefined
  }

  /** Called only for an admitted reconnect snapshot, never initial bootstrap. */
  prepareSnapshot(state: SessionState, sessionChanged: boolean) {
    const intent = this.capture()
    const frame = projectSessionSnapshot(
      state,
      true,
      !sessionChanged && intent === undefined ? "same-session-reconnect" : undefined,
    )
    return { frame, intent }
  }
}
