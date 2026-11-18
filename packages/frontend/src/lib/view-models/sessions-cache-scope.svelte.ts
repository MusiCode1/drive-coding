import type { SessionInfo } from "$lib/adapters/sessions"

/** Connection-scoped session list. Reborn when the connection is left — not on session switch. */
export class SessionsCacheScope {
  sessions = $state<SessionInfo[]>([])
  loading = $state<boolean>(false)
  error = $state<string | null>(null)
  #loaded = false

  async list(source: (() => Promise<SessionInfo[]>) | null, force?: boolean): Promise<void> {
    if (source === null) return
    if (this.loading) return
    if (this.#loaded && !force) return
    this.loading = true
    this.error = null
    try {
      this.sessions = await source()
      this.#loaded = true
    } catch (e) {
      if ((e as { code?: number }).code === -32601) {
        this.sessions = []
        this.#loaded = true
      } else {
        this.setError(e)
      }
    } finally {
      this.loading = false
    }
  }

  remove(sessionId: string): void {
    this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId)
  }

  reset(): void {
    this.sessions = []
    this.#loaded = false
    this.error = null
  }

  /** Normalizes rejection to a message and sets `error`. Sole external writer for `error`. */
  setError(e: unknown): void {
    this.error = e instanceof Error ? e.message : String(e)
  }
}
