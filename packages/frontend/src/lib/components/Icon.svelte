<script lang="ts">
/**
 * Icon.svelte — Lucide icon wrapper.
 *
 * Renders a <i data-lucide="..."> placeholder and calls lucide.createIcons()
 * after mount / on name change so Lucide replaces it with the actual SVG.
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

function refresh() {
  tick().then(() => {
    if (typeof lucide !== "undefined") {
      lucide.createIcons()
    }
  })
}

$effect(() => {
  void name // track name changes
  refresh()
})
</script>

<i
  data-lucide={name}
  style="width: {size}px; height: {size}px; stroke-width: {strokeWidth}; {extraStyle}"
  class={className}
></i>
