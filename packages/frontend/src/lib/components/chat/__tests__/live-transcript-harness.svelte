<script lang="ts">
/**
 * live-transcript-harness.svelte — mount LiveTranscript in vitest with minimal context stubs.
 *
 * ─── slice live-transcript-box ───
 */
import { setI18n, setLive, setVoiceMode } from "$lib/context"
import type { LiveTranscriptEntry } from "$lib/engines/live-session"
import type { VoiceMode } from "$lib/view-models/derived/voice-mode.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { Live } from "$lib/view-models/live.svelte"
import LiveTranscript from "../LiveTranscript.svelte"

let { transcript = [] }: { transcript?: LiveTranscriptEntry[] } = $props()

const liveStub = $state({ transcript: [] as LiveTranscriptEntry[] })

$effect(() => {
  liveStub.transcript = transcript
})

const fakeI18n = { t: (key: string) => key } as unknown as I18nVM
const fakeVoiceMode = { ear: "listening" } as unknown as VoiceMode

setI18n(fakeI18n)
setLive(liveStub as unknown as Live)
setVoiceMode(fakeVoiceMode)
</script>

<LiveTranscript />
