<script lang="ts">
  import { AudioDevicesVM } from "./audio-devices.svelte"
  import { Settings } from "./settings.svelte"

  export const settings = new Settings()
  export const vm = new AudioDevicesVM({ settings })
</script>
