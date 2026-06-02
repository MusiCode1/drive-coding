/**
 * UiShellVM — מצב ה-shell ה-UI הגלובלי (entity: חוצה chat + settings).
 *
 * sidebarCollapsed: בדסקטופ — האם הסייד-בר מקופל.
 * sheetOpen: במובייל — האם ה-bottom-sheet פתוח.
 *
 * הוא singleton גלובלי (נוצר ב-+layout.svelte) כי AppHeader + Sidebar + BottomSheet
 * כולם זקוקים לו בו-זמנית ורוחב-routes.
 *
 * ─── redesign-2 ───
 */
export class UiShellVM {
  sidebarCollapsed = $state(false)
  sheetOpen = $state(false)

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed
  }

  openSheet(): void {
    this.sheetOpen = true
  }

  closeSheet(): void {
    this.sheetOpen = false
  }

  toggleSheet(): void {
    this.sheetOpen = !this.sheetOpen
  }
}
