<script lang="ts">
import "../app.css"
import { setI18n, setSession, setSettings } from "$lib/context"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { I18nVM } from "$lib/view-models/i18n.svelte"
import { Settings } from "$lib/view-models/settings.svelte"

let { children } = $props()

// ── App-level singletons ────────────────────────────────────────
const i18n = new I18nVM()
const settings = new Settings()
const session = new AgentSession()

setI18n(i18n)
setSettings(settings)
setSession(session)
</script>

{@render children?.()}
