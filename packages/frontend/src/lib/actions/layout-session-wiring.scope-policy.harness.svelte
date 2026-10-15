<script lang="ts">
import { installSessionScopePolicy } from "$lib/actions/layout-session-wiring.svelte"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import { Settings } from "$lib/view-models/settings.svelte"

interface Props {
  agentId?: string | null
}

let { agentId = "550e8400-e29b-41d4-a716-446655440000" }: Props = $props()

const settings = new Settings()
const session = new AgentSession({ settings })

installSessionScopePolicy({ session, settings })

$effect(() => {
  session.agentId = agentId
})
</script>
