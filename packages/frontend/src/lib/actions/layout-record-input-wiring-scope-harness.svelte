<script lang="ts">
import { getComposerDraft, getDictate } from "$lib/context"
import { installRecordInput } from "./layout-record-input-wiring.svelte"

const deps: Pick<Parameters<typeof installRecordInput>[0], "session" | "beforeNavigate"> = $props()
const input = installRecordInput({
  get session() {
    return deps.session
  },
  beforeNavigate: (hook) => deps.beforeNavigate(hook),
})
input.installContexts()

export const mic = input.mic
export const dictate = getDictate()
export const draft = getComposerDraft()
</script>
