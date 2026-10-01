import type { SessionInfo } from "$lib/adapters/sessions"
import type { PatchOwner, SessionsCachePatch } from "./scopes/apply-patch"

/** Connection-scoped session list. Reborn when the connection is left — not on session switch. */
export class SessionsCacheScope implements PatchOwner<SessionsCachePatch> {
  #sessions = $state<SessionInfo[]>([])
  #loading = $state<boolean>(false)
  #error = $state<string | null>(null)
  #loaded = false

  get sessions(): SessionInfo[] {
    return this.#sessions
  }
  get loading(): boolean {
    return this.#loading
  }
  get error(): string | null {
    return this.#error
  }

  applyPatch(patch: SessionsCachePatch): void {
    switch (patch.kind) {
      case "list":
        this.#sessions = patch.sessions
        this.#loaded = true
        break
      case "remove":
        this.#sessions = this.#sessions.filter((s) => s.sessionId !== patch.sessionId)
        break
      case "reset":
        this.#sessions = []
        this.#loaded = false
        this.#error = null
        break
      case "loading":
        this.#loading = patch.loading
        break
      case "error":
        this.#error = patch.error
        break
    }
  }

  async list(source: (() => Promise<SessionInfo[]>) | null, force?: boolean): Promise<void> {
    if (source === null) return
    if (this.loading) return
    if (this.#loaded && !force) return
    this.applyPatch({ kind: "loading", loading: true })
    this.applyPatch({ kind: "error", error: null })
    try {
      this.applyPatch({ kind: "list", sessions: await source() })
    } catch (e) {
      if ((e as { code?: number }).code === -32601) {
        this.applyPatch({ kind: "list", sessions: [] })
      } else {
        this.setError(e)
      }
    } finally {
      this.applyPatch({ kind: "loading", loading: false })
    }
  }

  remove(sessionId: string): void {
    this.applyPatch({ kind: "remove", sessionId })
  }

  reset(): void {
    this.applyPatch({ kind: "reset" })
  }

  /** Normalizes rejection to a message and sets `error`. Sole external writer for `error`. */
  setError(e: unknown): void {
    this.applyPatch({ kind: "error", error: e instanceof Error ? e.message : String(e) })
  }
}
