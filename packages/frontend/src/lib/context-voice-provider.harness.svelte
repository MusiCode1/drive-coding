<script lang="ts">
import { setVoice } from "./context"
import type { VoiceFacade } from "./context"
import Consumer from "./context-voice-consumer.harness.svelte"

let { voice, inspect }: { voice: VoiceFacade; inspect: (values: VoiceFacade) => void } = $props()
// svelte-ignore state_referenced_locally
setVoice(voice)
</script>

<Consumer {inspect} />
