<script lang="ts">
import "../app.css"
import { setI18n, setSession, setSettings, setSpeaker } from "$lib/context"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Settings } from "$lib/view-models/settings.svelte"
import { Speaker } from "$lib/view-models/speaker.svelte"

let { children } = $props()

// ── App-level singletons ────────────────────────────────────────
const i18n = new I18nVM()
const settings = new Settings()
const session = new AgentSession()
const speaker = new Speaker({ session })

setI18n(i18n)
setSettings(settings)
setSession(session)
setSpeaker(speaker)
</script>

{@render children?.()}
