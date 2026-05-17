/**
 * sidebar-state.svelte.ts — reactive state for desktop Sidebar collapse.
 *
 * Singleton — persisted to sessionStorage for UX consistency across navigation.
 */

const KEY = "sidebar-collapsed"

function readPersisted(): boolean {
  if (typeof sessionStorage === "undefined") return false
  return sessionStorage.getItem(KEY) === "1"
}

let collapsed = $state(readPersisted())

export const sidebarState = {
  get isCollapsed() {
    return collapsed
  },
  toggle() {
    collapsed = !collapsed
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(KEY, collapsed ? "1" : "0")
    }
  },
  collapse() {
    collapsed = true
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(KEY, "1")
    }
  },
  expand() {
    collapsed = false
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(KEY, "0")
    }
  },
}
