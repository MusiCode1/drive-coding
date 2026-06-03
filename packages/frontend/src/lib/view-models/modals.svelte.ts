/**
 * ModalsVM — open/close state של modals גלובליים.
 *
 * Entity: UI-state גלובלי (פותחים מרובים: sidebar + sheet + /settings).
 * לפי חוק זהב #2 — entity שחי עצמאית בלי קשר לאיזה screen פתוח.
 *
 * ─── redesign-6 ───
 * ─── slice sessions-inline: הוסר sessionsOpen/openSessions/closeSessions ───
 *     סשנים מוצגים inline ב-SessionOptionsPanel (לא דרך dialog).
 *     FolderPicker נשאר (C10 + Settings).
 */
export class ModalsVM {
  folderOpen = $state(false)

  openFolder(): void {
    this.folderOpen = true
  }

  closeFolder(): void {
    this.folderOpen = false
  }
}
