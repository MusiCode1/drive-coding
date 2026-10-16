import { deleteAgent } from "$lib/adapters/agents-api"

/** Per-owner allocation ledger; ending a view never implies deleting its agent. */
export class ConnectionAllocation {
  #agents = new Map<string, { deleted: boolean; released: boolean }>()

  #entry(agentId: string): { deleted: boolean; released: boolean } {
    let entry = this.#agents.get(agentId)
    if (!entry) {
      entry = { deleted: false, released: false }
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

  releaseOnce(agentId: string): boolean {
    const entry = this.#entry(agentId)
    if (entry.released) return false
    entry.released = true
    return true
  }
}
