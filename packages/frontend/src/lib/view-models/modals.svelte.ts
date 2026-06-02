/**
 * ModalsVM — open/close state של modals גלובליים.
 *
 * Entity: UI-state גלובלי (פותחים מרובים: sidebar + sheet + /settings).
 * לפי חוק זהב #2 — entity שחי עצמאית בלי קשר לאיזה screen פתוח.
 *
 * ─── redesign-6 ───
 */
export class ModalsVM {
  sessionsOpen = $state(false)
  folderOpen = $state(false)

  openSessions(): void {
    this.sessionsOpen = true
  }

  openFolder(): void {
    this.folderOpen = true
  }

  closeSessions(): void {
    this.sessionsOpen = false
  }

  closeFolder(): void {
    this.folderOpen = false
  }
}
