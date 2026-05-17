<script lang="ts">
import "../app.css"
import { onMount } from "svelte"

let { children } = $props()

onMount(() => {
  // Initialize Lucide icons on first render.
  // Individual Icon.svelte components also call this on mount/update.
  if (typeof lucide !== "undefined") {
    lucide.createIcons()
  }
})
</script>

{@render children?.()}
