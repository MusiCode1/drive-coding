/**
 * ContentViewerVM — UI-state גלובלי של דיאלוג fullscreen לתצוגת תוכן.
 *
 * Entity: UI גלובלי נושא-payload (עקבי עם ModalsVM, חוק זהב #2).
 * VM נפרד ולא הרחבה של ModalsVM כי הוא נושא payload לא-טריוויאלי
 * (discriminated union) + לוגיקת show-with-payload.
 *
 * ─── slice content-viewer ───
 */

/** payload להצגה ב-ContentViewer. discriminated union — תוספת type עתידית = ענף חדש. */
export type ViewerPayload =
  | { kind: "markdown"; text: string; title?: string }
  | { kind: "image"; src: string; alt?: string }

/**
 * ContentViewerVM — UI-state גלובלי של הדיאלוג fullscreen.
 * Entity: UI גלובלי נושא-payload (עקבי עם ModalsVM, חוק זהב #2).
 */
export class ContentViewerVM {
  payload = $state<ViewerPayload | null>(null)

  get open(): boolean {
    return this.payload !== null
  }

  show(payload: ViewerPayload): void {
    this.payload = payload
  }

  close(): void {
    this.payload = null
  }
}
