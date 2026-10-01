<script lang="ts">
import { getAudioPlaylist, getBubblePlayer, getCues, getDictate, getLive, getMic, getSpeaker, getVoiceMode } from "./context"
import type { VoiceFacade } from "./context"

let { inspect }: { inspect: (values: VoiceFacade) => void } = $props()
const speaker = getSpeaker()
// svelte-ignore state_referenced_locally
inspect({ speaker, mic: getMic(), live: getLive(), voiceMode: getVoiceMode(), cues: getCues(), bubblePlayer: getBubblePlayer(), audioPlaylist: getAudioPlaylist(), dictate: getDictate() })
</script>

<output data-voice-state>{speaker.state}</output>
