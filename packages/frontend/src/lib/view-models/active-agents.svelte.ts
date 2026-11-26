import type { AgentPublic } from "@drive-coding/core"
import { type AgentTree, buildAgentTree } from "@drive-coding/core/agents/agent-tree"
import { deleteAgent, listAgents, setAgentPersistent } from "$lib/adapters/agents-api"
import { isPageHidden } from "$lib/util/page-visibility.svelte"

const REFRESH_INTERVAL_MS = 12_000
const EMPTY_AGENTS: AgentPublic[] = []
const EMPTY_TREE = buildAgentTree(EMPTY_AGENTS)

export class ActiveAgents {
  #snapshot = $state.raw<{ agents: AgentPublic[]; tree: AgentTree<AgentPublic> }>()
  get agents(): AgentPublic[] {
    return this.#snapshot?.agents ?? EMPTY_AGENTS
  }
  set agents(agents: AgentPublic[]) {
    this.#snapshot = { agents, tree: buildAgentTree(agents) }
  }
  get tree(): AgentTree<AgentPublic> {
    return this.#snapshot?.tree ?? EMPTY_TREE
  }
  get hasSnapshot(): boolean {
    return this.#snapshot !== undefined
  }
  loading = $state(false)
  error = $state<string | null>(null)
  #pending: Promise<void> | undefined
  #lastSuccess = -Infinity
  #consumers = 0
  #onPoll = new Set<() => void>()
  #interval: ReturnType<typeof setInterval> | undefined

  refresh = (): Promise<void> => {
    if (this.#pending) return this.#pending

    this.loading = true
    this.error = null
    this.#pending = listAgents()
      .then((agents) => {
        this.agents = agents
        this.#lastSuccess = Date.now()
      })
      .catch((error: unknown) => {
        this.#lastSuccess = -Infinity
        this.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        this.loading = false
        this.#pending = undefined
      })
    return this.#pending
  }

  subscribe = (onPoll?: () => void): (() => void) => {
    if (onPoll) {
      this.#onPoll.add(onPoll)
      onPoll()
    }
    if (++this.#consumers === 1) {
      this.#interval = setInterval(() => {
        if (isPageHidden()) return
        void this.refresh()
        for (const listener of this.#onPoll) listener()
      }, REFRESH_INTERVAL_MS)
    }
    if (this.#pending || Date.now() - this.#lastSuccess >= REFRESH_INTERVAL_MS) void this.refresh()
    return () => {
      if (onPoll) this.#onPoll.delete(onPoll)
      if (--this.#consumers === 0) clearInterval(this.#interval)
    }
  }

  #refreshAfterMutation = (): Promise<void> => {
    // A GET already in flight may have captured the old list. The next GET can be shared.
    return (this.#pending ?? Promise.resolve()).then(this.refresh)
  }

  setPersistent = (id: string, persistent: boolean): Promise<void> =>
    setAgentPersistent(id, persistent).then(this.#refreshAfterMutation)

  kill = (id: string): Promise<void> => deleteAgent(id).then(this.#refreshAfterMutation)
}
