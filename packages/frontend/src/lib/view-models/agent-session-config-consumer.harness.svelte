<script lang="ts">
import { AgentSession } from "./agent-session.svelte"

const session = new AgentSession()
export function getSession(): AgentSession {
  return session
}
</script>

<p data-testid="config-count">{session.config.configOptions.length}</p>
