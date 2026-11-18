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

export type AgentGroup = { root: AgentPublic; children: AgentPublic[] }

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

  /** slice agent-tree-display: קיבוץ סוכני-משנה תחת ההורה (רמה אחת, §3 בבריף). */
  get grouped(): AgentGroup[] {
    const agents = this.agents
    const agentIds = new Set(agents.map((a) => a.id))

    const childrenByParent = new Map<string, AgentPublic[]>()
    for (const agent of agents) {
      const parentId = agent.parentAgentId
      if (parentId !== undefined && parentId !== agent.id) {
        const siblings = childrenByParent.get(parentId) ?? []
        siblings.push(agent)
        childrenByParent.set(parentId, siblings)
      }
    }

    const roots: AgentPublic[] = []
    for (const agent of agents) {
      const parentId = agent.parentAgentId
      if (
        parentId === undefined ||
        parentId === agent.id ||
        !agentIds.has(parentId)
      ) {
        roots.push(agent)
      }
    }

    const claimed: AgentPublic[] = []
    for (const root of roots) {
      const children = childrenByParent.get(root.id)
      if (children) claimed.push(...children)
    }

    const accounted = new Set<string>()
    for (const root of roots) accounted.add(root.id)
    for (const child of claimed) accounted.add(child.id)

    const leftover = agents.filter((a) => !accounted.has(a.id))

    const grouped: AgentGroup[] = roots.map((root) => ({
      root,
      children: childrenByParent.get(root.id) ?? [],
    }))
    for (const agent of leftover) {
      grouped.push({ root: agent, children: [] })
    }

    return grouped
  }
}
