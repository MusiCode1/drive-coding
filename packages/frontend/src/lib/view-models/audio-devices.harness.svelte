<svelte:options runes={false} />

<script lang="ts">
  import { AudioDevicesVM } from "./audio-devices.svelte"
  import { Settings } from "./settings.svelte"

  export let prefId: string | null = null
  export let prefLabel = ""

  export const settings = new Settings()
  if (prefId) {
    settings.setInputDevice(prefId, prefLabel)
  }
  export const vm = new AudioDevicesVM({ settings })
</script>
