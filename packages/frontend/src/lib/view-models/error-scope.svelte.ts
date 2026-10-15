/** Reactive owner for session error banner state (message, control flag, turn-sync source). No IO. */
export class ErrorScope {
  message = $state<string | null>(null)
  /** True after terminal attach/loadSession/detach failures — anti-clobber for reconnect. */
  surfaced = $state(false)
  /** Message string last written by lastTurnError sync — enables targeted clear. */
  fromTurn = $state<string | null>(null)

  /** Clears banner message and control flag; does not reset fromTurn (base parity). */
  reset(): void {
    this.message = null
    this.surfaced = false
  }

  /** Terminal failure: message + surfaced (attach/loadSession catch, HTTP failed, etc.). */
  surface(message: string): void {
    this.message = message
    this.surfaced = true
  }

  /**
   * Parity with base #syncFromViewState lastTurnError block — no dedup, no sticky terminal.
   */
  syncTurnError(lastTurnError: { message: string } | null | undefined): void {
    if (lastTurnError) {
      this.message = `prompt failed: ${lastTurnError.message}`
      this.fromTurn = this.message
    } else if (this.message !== null && this.message === this.fromTurn) {
      this.message = null
      this.fromTurn = null
    }
  }
}
