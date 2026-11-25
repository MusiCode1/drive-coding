export const HISTORY_EDGE_HEIGHT = 56
export const HISTORY_START_MARGIN = 80 + HISTORY_EDGE_HEIGHT
const TOP_LOAD_THRESHOLD_PX = 24

export function observeHistoryEdge(node: HTMLElement, onVisible: () => void) {
  if (typeof IntersectionObserver === "undefined") return
  const root = node.closest(".chat-scroll")
  let awayFromTop = false
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1)
      if (!entry) return
      if (!entry.isIntersecting) {
        awayFromTop = true
      } else if (awayFromTop || !root || root.scrollHeight <= root.clientHeight) {
        // A scrollable tail first renders at offset zero, before follow-to-bottom.
        onVisible()
      }
    },
    { root, rootMargin: `${TOP_LOAD_THRESHOLD_PX}px 0px 0px` },
  )
  observer.observe(node)
  return { destroy: () => observer.disconnect() }
}
