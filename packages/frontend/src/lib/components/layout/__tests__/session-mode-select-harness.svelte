<script lang="ts">
import { setI18n, setResponsive } from "$lib/context"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { I18nVM } from "$lib/view-models/i18n.svelte"
import type { ResponsiveVM } from "$lib/view-models/responsive.svelte"
import SessionModeSelect from "../SessionModeSelect.svelte"

let { agent }: { agent: AgentSession } = $props()
setI18n({ t: (key: string) => key } as I18nVM)
setResponsive({ isMobile: false } as ResponsiveVM)
</script>

<SessionModeSelect configOptions={agent.configOptions} modes={agent.modes} onChange={agent.applyConfigOption} />
