/** Cancellation state shared by backoff and each async reconnect step. */
export class WsReconnectAttempt {
  #generation = 0
  #timer: ReturnType<typeof setTimeout> | undefined
  #finishWait: (() => void) | undefined
  #cancelActive = new Set<() => void>()

  get generation(): number {
    return this.#generation
  }

  cancel(): void {
    this.#generation++
    for (const cancel of this.#cancelActive) cancel()
    this.#cancelActive.clear()
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#finishWait?.()
    this.#finishWait = undefined
  }

  isCurrent(generation: number, allowed: () => boolean): boolean {
    return generation === this.#generation && allowed()
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.#finishWait = resolve
      this.#timer = setTimeout(() => {
        this.#timer = undefined
        this.#finishWait = undefined
        resolve()
      }, ms)
    })
  }

  async awaitCurrent<T>(
    task: Promise<T>,
    generation: number,
    allowed: () => boolean,
  ): Promise<{ kind: "value"; value: T } | { kind: "cancelled" }> {
    if (!this.isCurrent(generation, allowed)) return { kind: "cancelled" }
    let cancel!: () => void
    const cancelled = new Promise<{ kind: "cancelled" }>((resolve) => {
      cancel = () => resolve({ kind: "cancelled" })
    })
    this.#cancelActive.add(cancel)
    try {
      return await Promise.race([
        task.then((value) => ({ kind: "value" as const, value })),
        cancelled,
      ])
    } finally {
      this.#cancelActive.delete(cancel)
    }
  }
}
