<script lang="ts">
import "../app.css"
import { setSession, setSettings } from "$lib/context"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { Settings } from "$lib/view-models/settings.svelte"

let { children } = $props()

// ── App-level singletons ────────────────────────────────────────
const settings = new Settings()
const session = new AgentSession()

setSettings(settings)
setSession(session)
</script>

{@render children?.()}
