import { randomUUID } from "node:crypto"
import type { Agent, AgentRegistry, CreateAgentInput } from "@drive-coding/core"
import { validateCwd } from "@drive-coding/core"

/**
 * In-memory AgentRegistry.
 * נאבד ב-restart (D8 — acceptable ל-MVP).
 * Thread-safe? Bun + Node single-threaded JS — yes.
 */
export function createInMemoryAgentRegistry(): AgentRegistry {
  const store = new Map<string, Agent>()

  return {
    async create(input: CreateAgentInput): Promise<Agent> {
      // Belt-and-suspenders: validate cwd even if http-agents already checked it.
      // Guards against direct registry calls that bypass the HTTP layer.
      const cwdResult = validateCwd(input.cwd)
      if (cwdResult.isErr()) {
        throw new Error(`invalid cwd: ${cwdResult.error.kind}`)
      }

      const id = randomUUID()
      const agent: Agent = {
        id,
        cliKind: input.cliKind,
        cwd: cwdResult.value, // normalised
        modelOverride: input.modelOverride ?? null,
        status: "ready", // Slice 2 stub. Slice 3+: starting → ready
        createdAt: new Date().toISOString(),
      }
      store.set(id, agent)
      return agent
    },

    async get(id: string): Promise<Agent | null> {
      return store.get(id) ?? null
    },

    async list(): Promise<ReadonlyArray<Agent>> {
      return [...store.values()]
    },

    async update(id, patch): Promise<Agent> {
      const existing = store.get(id)
      if (!existing) throw new Error(`Agent ${id} not found`)
      const updated: Agent = { ...existing, ...patch }
      store.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<void> {
      if (!store.has(id)) throw new Error(`Agent ${id} not found`)
      store.delete(id)
    },
  }
}
