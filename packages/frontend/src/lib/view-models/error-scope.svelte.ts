type ErrorOrigin = "terminal" | "transient" | "external" | "turn" | null

/** Display text, reconnect policy, and turn provenance share one owner. */
export class ErrorScope {
  message = $state<string | null>(null)
  #terminal = false
  #origin: ErrorOrigin = null
  #seenTurn: { message: string; at: number } | null = null

  get terminal(): boolean {
    return this.#terminal
  }

  reset(): void {
    this.message = null
    this.#terminal = false
    this.#origin = null
    this.#seenTurn = null
  }

  setTransient(message: string): void {
    this.message = message
    this.#origin = "transient"
  }

  setTerminal(message: string | null): void {
    this.message = message
    this.#terminal = true
    this.#origin = "terminal"
  }

  syncTurnError(record: { message: string; at: number } | null): void {
    if (record === null) {
      this.#seenTurn = null
      if (this.#origin === "turn") this.dismiss()
      return
    }
    if (this.#seenTurn?.at === record.at && this.#seenTurn.message === record.message) return
    this.#seenTurn = { message: record.message, at: record.at }
    this.message = `prompt failed: ${record.message}`
    this.#origin = "turn"
  }

  clearTransient(): void {
    if (this.#terminal || this.#origin === "turn") return
    this.dismiss()
  }

  setExternal(message: string | null): void {
    if (message === null) {
      this.dismiss()
      return
    }
    this.message = message
    this.#origin = "external"
  }

  dismiss(): void {
    this.message = null
    this.#origin = null
  }
}
