import { deleteAgent } from "$lib/adapters/agents-api"

/** Per-owner allocation ledger; ending a view never implies deleting its agent. */
export class ConnectionAllocation {
  #agents = new Map<string, { deleted: boolean }>()

  #entry(agentId: string): { deleted: boolean } {
    let entry = this.#agents.get(agentId)
    if (!entry) {
      entry = { deleted: false }
      this.#agents.set(agentId, entry)
    }
    return entry
  }

  deleteOnce(agentId: string, discard?: (agentId: string) => void): void {
    const entry = this.#entry(agentId)
    if (entry.deleted) return
    entry.deleted = true
    if (discard) discard(agentId)
    else void deleteAgent(agentId).catch(() => {})
  }
}
