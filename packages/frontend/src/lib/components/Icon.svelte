<script lang="ts">
/**
 * Icon.svelte — Lucide icon wrapper.
 *
 * N5 fix: Previous implementation rendered <i data-lucide="..."> and called
 * lucide.createIcons() globally. Lucide replaced the <i> with <svg> directly
 * in the DOM (via replaceWith), bypassing Svelte's virtual DOM. When the icon
 * name changed, Svelte would create a new <i> but not remove the old <svg>
 * Lucide left behind — causing double icons.
 *
 * Fix: use a transparent <span> container managed by Svelte. On every name/size
 * change, clear the container (removing any stale SVGs) and insert a fresh <i>
 * before calling createIcons(). Lucide only ever sees one <i> per container.
 *
 * Usage:
 *   <Icon name="mic" />
 *   <Icon name="brain" size={14} strokeWidth={1.5} />
 */
import { tick } from "svelte"

interface Props {
  name: string
  size?: number
  strokeWidth?: number
  class?: string
  style?: string
}

let {
  name,
  size = 18,
  strokeWidth = 1.75,
  class: className = "",
  style: extraStyle = "",
}: Props = $props()

let container: HTMLSpanElement | null = $state(null)

$effect(() => {
  // Access all reactive props to track them in this effect
  const iconName = name
  const iconSize = size
  const iconStrokeWidth = strokeWidth
  const iconStyle = extraStyle
  const iconClass = className

  if (!container) return

  // Clear any Lucide-injected SVGs left from previous renders (N5 fix)
  container.innerHTML = ""

  // Create a fresh <i> element for Lucide to replace with the real SVG
  const i = document.createElement("i")
  i.setAttribute("data-lucide", iconName)
  // Lucide copies attributes from <i> to the resulting <svg>, so set class + style here
  if (iconClass) i.className = iconClass
  i.style.cssText = `width: ${iconSize}px; height: ${iconSize}px; stroke-width: ${iconStrokeWidth}; ${iconStyle}`
  container.appendChild(i)

  tick().then(() => {
    if (typeof lucide !== "undefined") {
      lucide.createIcons()
    }
  })
})
</script>

<!-- display:contents makes the span transparent to layout — children behave
     as if they're direct children of the parent element. -->
<span bind:this={container} style="display: contents"></span>
