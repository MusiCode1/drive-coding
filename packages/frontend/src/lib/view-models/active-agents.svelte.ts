/**
 * active-agents.svelte.ts — VM לרשימת ה-agents החיים בצד-השרת.
 *
 * מנהל: טעינה, Pin (persistent toggle), Kill.
 * מעביר ל-ActiveProcessesPanel דרך context.
 *
 * slice: active-agents-widget
 */
import type { AgentPublic } from "@drive-coding/core"
import { listAgents, deleteAgent, setAgentPersistent } from "$lib/adapters/agents-api"

export class ActiveAgents {
  agents = $state<AgentPublic[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  refresh = async (): Promise<void> => {
    this.loading = true
    this.error = null
    try {
      this.agents = await listAgents()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.loading = false
    }
  }

  setPersistent = async (id: string, persistent: boolean): Promise<void> => {
    await setAgentPersistent(id, persistent)
    await this.refresh()
  }

  kill = async (id: string): Promise<void> => {
    await deleteAgent(id)
    await this.refresh()
  }
}
