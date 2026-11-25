import type { SessionListCapabilities, SessionListQuery } from "@drive-coding/core/session"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { SessionView } from "$lib/session/session-view"

type ListSource = Pick<SessionView, "listSessions">

type SessionListState = {
  items: SessionInfo[]
  nextCursor?: string
  /** Undefined before the first response, null for a legacy page. */
  capabilities?: SessionListCapabilities | null
  legacyCanDelete: boolean
  deleteRejected: boolean
}

function emptyList(): SessionListState {
  return { items: [], legacyCanDelete: false, deleteRejected: false }
}

/** Owns the visible pages for one view and cwd at a time. */
export class SessionsCacheScope {
  sessions = $state<SessionListState>(emptyList())
  loading = $state(false)
  error = $state<string | null>(null)
  #view: ListSource | null = null
  #cwd: string | undefined
  #generation = 0
  #loaded = false
  #consumed = new Set<string>()

  async list(view: ListSource, force = false, { cwd }: SessionListQuery = {}): Promise<void> {
    this.#useView(view)
    if (!force && this.#cwd === cwd && (this.loading || this.#loaded)) return

    this.#generation += 1
    this.#cwd = cwd
    this.#loaded = false
    this.#consumed.clear()
    this.sessions.items = []
    this.sessions.nextCursor = undefined
    await this.#request(view, { cwd })
  }

  async loadMore(view: ListSource): Promise<void> {
    const cursor = this.sessions.nextCursor
    if (view !== this.#view || this.loading || cursor === undefined) return
    await this.#request(view, { cwd: this.#cwd, cursor })
  }

  async #request(view: ListSource, { cwd, cursor }: SessionListQuery): Promise<void> {
    const generation = this.#generation
    this.loading = true
    this.error = null
    try {
      const page = await view.listSessions({
        ...(cwd !== undefined && { cwd }),
        ...(cursor !== undefined && { cursor }),
      })
      if (generation !== this.#generation) return
      if (cursor !== undefined) this.#consumed.add(cursor)

      const items = cursor === undefined ? [] : this.sessions.items.slice()
      const seen = new Set(items.map((item) => item.sessionId))
      for (const item of page.sessions) {
        if (seen.has(item.sessionId)) continue
        seen.add(item.sessionId)
        items.push(item)
      }
      this.sessions.items = items
      this.sessions.capabilities = page.capabilities
      this.sessions.legacyCanDelete = page.legacyCanDelete
      this.sessions.nextCursor =
        page.nextCursor !== undefined && !this.#consumed.has(page.nextCursor)
          ? page.nextCursor
          : undefined
      this.#loaded = true
    } catch (e) {
      if (generation !== this.#generation) return
      if ((e as { code?: number } | null)?.code === -32601) {
        this.sessions.capabilities = { list: false, filterByCwd: false, delete: false }
        this.sessions.nextCursor = undefined
        this.#loaded = true
      } else {
        this.setError(e)
      }
    } finally {
      if (generation === this.#generation) this.loading = false
    }
  }

  supportsDelete(view: ListSource | null): boolean {
    const { capabilities, legacyCanDelete, deleteRejected } = this.sessions
    return (
      view !== null &&
      this.#view === view &&
      !deleteRejected &&
      (capabilities === null ? legacyCanDelete : capabilities?.delete === true)
    )
  }

  rejectDelete(view: ListSource): void {
    this.#useView(view)
    this.sessions.deleteRejected = true
  }

  remove(view: ListSource, sessionId: string): void {
    if (view !== this.#view) return
    const restartFirstPage = this.loading && !this.#loaded
    this.#generation += 1
    this.loading = false
    this.sessions.items = this.sessions.items.filter((item) => item.sessionId !== sessionId)
    if (restartFirstPage) void this.list(view, true, { cwd: this.#cwd })
  }

  reset(): void {
    this.#generation += 1
    this.#view = null
    this.#cwd = undefined
    this.#loaded = false
    this.#consumed.clear()
    this.sessions = emptyList()
    this.loading = false
    this.error = null
  }

  #useView(view: ListSource): void {
    if (view === this.#view) return
    this.reset()
    this.#view = view
  }

  setError(e: unknown): void {
    this.error = e instanceof Error ? e.message : String(e)
  }
}
