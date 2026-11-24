import type { Action } from "svelte/action"

/** Put a scroll box on its last line. The browser clamps past the real maximum. */
export function pinScrollToEnd(node: HTMLElement): void {
  node.scrollTop = node.scrollHeight
}

export const pinTruncatedEnd: Action<HTMLElement, boolean> = (node, active) => {
  let on = active
  let frame = 0
  const snap = () => {
    if (on) pinScrollToEnd(node)
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    snap()
    frame = requestAnimationFrame(snap)
  }
  if (on) schedule()
  return {
    update(next) {
      const opened = next && !on
      on = next
      if (opened) schedule()
    },
    destroy() {
      cancelAnimationFrame(frame)
    },
  }
}
