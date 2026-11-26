<script lang="ts">
import { createI18n } from "@drive-coding/core/i18n"
import { untrack } from "svelte"
import { setCliAvailability, setI18n, setPresencePoller, setPromptRetry, setSession } from "$lib/context"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import { CliAvailability } from "$lib/view-models/cli-availability.svelte"
import { DictateSubmit } from "$lib/view-models/dictate-submit.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { PresencePoller } from "$lib/view-models/presence-poller.svelte"
import type { PromptRetry } from "$lib/view-models/prompt-retry.svelte"
import ChatSessionStatus from "../ChatSessionStatus.svelte"

let { prompts }: { prompts: PromptRetry } = $props()
setI18n(createI18n({ locale: "he" }) as unknown as I18nVM)
setSession({ error: null, cliKind: "fixture", turnStalled: false } as unknown as AgentSession)
setPresencePoller({ banner: null } as unknown as PresencePoller)
setCliAvailability(new CliAvailability())
const initialPrompts = untrack(() => prompts)
setPromptRetry({ prompts: initialPrompts, dictateSubmit: new DictateSubmit(initialPrompts) })
</script>

<ChatSessionStatus />
