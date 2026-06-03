<script lang="ts">
  import type { LucideIcon } from "@lucide/svelte"

  let { icon, size = 20, strokeWidth = 1.75, class: cls = "" }:
    { icon: LucideIcon; size?: number; strokeWidth?: number; class?: string } = $props()

  const Cmp = $derived(icon)
</script>
<Cmp {size} {strokeWidth} class={cls} />
