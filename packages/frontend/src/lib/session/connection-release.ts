import { releaseConnection } from "$lib/adapters/agents-api"

/** Ownership is released once per adopted connection, independently of agent deletion. */
export class ConnectionRelease {
  #identity:
    | { agentId: string; connectionId: string; generation: number; released: boolean }
    | undefined

  capture(agentId: string, connectionId: string, generation: number): void {
    const previous = this.#identity
    if (
      previous?.agentId === agentId &&
      previous.connectionId === connectionId &&
      previous.generation === generation
    )
      return
    this.#identity = { agentId, connectionId, generation, released: false }
  }

  updateAgent(agentId: string, generation: number): void {
    const previous = this.#identity
    if (previous) this.capture(agentId, previous.connectionId, generation)
  }

  release(): void {
    const identity = this.#identity
    if (!identity || identity.released) return
    identity.released = true
    void releaseConnection(identity.agentId, identity.connectionId)
  }
}
