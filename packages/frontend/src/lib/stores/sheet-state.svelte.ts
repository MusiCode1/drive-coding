/**
 * sheet-state.svelte.ts — reactive state for the mobile BottomSheet.
 *
 * Singleton so FloatingHeader, BottomSheet, and the page can all
 * share the same open/close state without prop-drilling.
 */

let open = $state(false)

export const sheetState = {
  get isOpen() {
    return open
  },
  open() {
    open = true
  },
  close() {
    open = false
  },
  toggle() {
    open = !open
  },
}
