import { tick } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import type { VirtualizerHandle } from "virtua/svelte"
import type { DisplayItem } from "./bubbles/activity-groups"

type Anchor = { id: string; collapsed: boolean; top: number }
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function visibleAnchor(scroller: HTMLElement): Anchor | undefined {
  const viewport = scroller.getBoundingClientRect()
  for (const node of scroller.querySelectorAll<HTMLElement>(
    "[data-history-bubble], [data-history-group]",
  )) {
    const { top, bottom } = node.getBoundingClientRect()
    const id = node.dataset.historyBubble ?? node.dataset.historyGroup
    if (id && bottom > viewport.top && top < viewport.bottom) {
      return { id, top: top - viewport.top, collapsed: node.dataset.historyGroup !== undefined }
    }
  }
}

function containsBubble(item: DisplayItem, id: string): boolean {
  return item.kind === "single"
    ? item.bubble.id === id
    : item.bubbles.some((bubble) => bubble.id === id)
}

export function createHistoryScroll(
  items: () => readonly DisplayItem[],
  scroller: () => HTMLElement | null,
  handle: () => VirtualizerHandle | undefined,
) {
  const openGroups = new SvelteSet<string>()
  let anchor: Anchor | undefined
  let head: Extract<DisplayItem, { kind: "activity-group" }> | undefined
  let generation = 0

  function transferExpansion(rows: readonly DisplayItem[]): void {
    const first = head?.bubbles[0]
    if (!head || !first) return
    const merged = rows.find(
      (item) => item.kind === "activity-group" && containsBubble(item, first.id),
    )
    if (!merged || merged.key === head.key) return
    if (openGroups.delete(head.key)) openGroups.add(merged.key)
    else openGroups.delete(merged.key)
  }

  async function restore(
    root: HTMLElement,
    saved: Anchor,
    rows: readonly DisplayItem[],
    epoch: number,
  ) {
    const index = rows.findIndex((item) => containsBubble(item, saved.id))
    const item = rows[index]
    if (!item) return
    const id = saved.collapsed && item.kind === "activity-group" ? item.bubbles[0]?.id : saved.id
    const attribute = saved.collapsed ? "data-history-group" : "data-history-bubble"
    const target = () =>
      Array.from(root.querySelectorAll(`[${attribute}]`)).find(
        (node) => node.getAttribute(attribute) === id,
      )
    await tick()
    await nextFrame()
    if (epoch !== generation || root !== scroller()) return
    if (!target()) handle()?.scrollToIndex(index)
    // The first flush can still use estimated heights for newly mounted rows.
    for (let frame = 0; frame < 4; frame++) {
      await nextFrame()
      if (epoch !== generation || root !== scroller()) return
      const row = target()
      if (row)
        root.scrollTop +=
          row.getBoundingClientRect().top - root.getBoundingClientRect().top - saved.top
    }
  }

  return {
    isOpen: (key: string) => openGroups.has(key),
    setOpen(key: string, open: boolean) {
      if (open) openGroups.add(key)
      else openGroups.delete(key)
    },
    reset() {
      generation++
      anchor = undefined
      head = undefined
      openGroups.clear()
    },
    onApplying() {
      generation++
      const root = scroller()
      anchor = root ? visibleAnchor(root) : undefined
      const first = items()[0]
      head = first?.kind === "activity-group" ? first : undefined
    },
    async onApplied() {
      const rows = items()
      transferExpansion(rows)
      head = undefined
      const saved = anchor
      anchor = undefined
      const root = scroller()
      if (saved && root) await restore(root, saved, rows, generation)
    },
  }
}
