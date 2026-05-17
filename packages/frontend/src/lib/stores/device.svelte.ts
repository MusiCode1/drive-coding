/**
 * device.svelte.ts — reactive viewport breakpoint detection.
 *
 * Singleton module-level $state — shared across all importers.
 * isMobile: true when viewport width < 1024px (mobile-first breakpoint).
 *
 * SSR-safe: defaults to false (desktop), browser-initialized on import.
 */

let isMobile = $state(false)

if (typeof window !== "undefined") {
  const mq = window.matchMedia("(max-width: 1023px)")
  isMobile = mq.matches
  mq.addEventListener("change", (e) => {
    isMobile = e.matches
  })
}

export const device = {
  get isMobile() {
    return isMobile
  },
  get isDesktop() {
    return !isMobile
  },
}
