<script lang="ts">
/** voice-chip-harness.svelte — mounts a VoiceChip popup row with a key-echo i18n (slice codex-voice-poc). */
import { setI18n } from "$lib/context"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { VoiceChipOption } from "../VoiceChip.svelte"
import VoiceChipRow from "../VoiceChipRow.svelte"

let {
  option,
  selected = false,
  playing = false,
  onpick,
  onpreview,
}: {
  option: VoiceChipOption
  selected?: boolean
  playing?: boolean
  onpick: () => void
  onpreview?: (() => void) | undefined
} = $props()

setI18n({ t: (key: string) => key } as unknown as I18nVM)
</script>

<VoiceChipRow {option} {selected} {playing} {onpick} {onpreview} />
