/** נקודת עצירה של ה-bottom-sheet (מובייל). peek = רק הידית מציצה. */
export type SheetDetent = "peek" | "half" | "full"

/** מצב אזור-הקלט בתחתית הצ'אט — record / typing / live / hidden. */
export type InputMode = "record" | "typing" | "live" | "hidden"

/** Coerce persisted / unknown values to a valid InputMode. */
export function coerceInputMode(v: unknown): InputMode {
  if (v === "record" || v === "typing" || v === "live" || v === "hidden") return v
  return "record"
}

/**
 * UiShellVM — מצב ה-shell ה-UI הגלובלי (entity: חוצה chat + settings).
 *
 * sidebarCollapsed: בדסקטופ — האם הסייד-בר מקופל.
 * sheetDetent: במובייל — נקודת העצירה של ה-bottom-sheet (peek/half/full).
 * sheetDragPx: גובה רציף בזמן גרירה (null = לא גוררים → הגובה נגזר מה-detent).
 *
 * singleton גלובלי (נוצר ב-+layout.svelte) — AppHeader + Sidebar + BottomSheet
 * זקוקים לו בו-זמנית ורוחב-routes.
 *
 * ─── redesign-2 ───  ·  detents (גרירה רציפה + 3 נקודות עצירה): redesign-fix
 */
export class UiShellVM {
  sidebarCollapsed = $state(false)
  sheetDetent = $state<SheetDetent>("peek")
  /** גובה הגלוי (px) בזמן גרירה — null כשלא גוררים. ה-component קובע. */
  sheetDragPx = $state<number | null>(null)

  /** מצב אזור-הקלט (RecordFooter) — ברירת מחדל record. */
  inputMode = $state<InputMode>("record")

  /** תאימות: "פתוח" = כל detent שאינו peek. נצרך ל-backdrop ולחיצות חוץ. */
  get sheetOpen(): boolean {
    return this.sheetDetent !== "peek"
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed
  }

  setDetent(detent: SheetDetent): void {
    this.sheetDetent = detent
    this.sheetDragPx = null
  }

  openSheet(): void {
    this.setDetent("full")
  }

  closeSheet(): void {
    this.setDetent("peek")
  }

  /** קליק על הידית: peek → full, אחרת → peek. */
  toggleSheet(): void {
    this.setDetent(this.sheetDetent === "peek" ? "full" : "peek")
  }

  setInputMode(mode: InputMode): void {
    this.inputMode = mode
  }
}
