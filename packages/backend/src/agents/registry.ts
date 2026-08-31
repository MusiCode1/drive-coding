import { randomUUID } from "node:crypto"
import type { Agent, AgentRegistry, CreateAgentInput } from "@drive-coding/core"
import { validateCwd } from "@drive-coding/core"

/**
 * AgentRegistry בזיכרון.
 * נאבד ב-restart (D8 — acceptable ל-MVP).
 * האם Thread-safe? כן, Bun ו-Node מריצים JS ב-thread יחיד.
 */
export function createInMemoryAgentRegistry(): AgentRegistry {
  const store = new Map<string, Agent>()

  return {
    async create(input: CreateAgentInput): Promise<Agent> {
      // חגורה ושלייקס: אימות ה-cwd גם אם http-agents כבר בדק אותו.
      // מגן מפני קריאות ישירות ל-registry שעוקפות את שכבת ה-HTTP.
      const cwdResult = validateCwd(input.cwd)
      if (cwdResult.isErr()) {
        throw new Error(`invalid cwd: ${cwdResult.error.kind}`)
      }

      const id = randomUUID()
      const agent: Agent = {
        id,
        cliKind: input.cliKind,
        cwd: cwdResult.value, // מנורמל
        modelOverride: input.modelOverride ?? null,
        status: "ready", // Slice 2 stub. ב-Slice 3 ומעלה: starting → ready
        createdAt: new Date().toISOString(),
        persistent: false,   // ← agent נוצר לא-נעוץ (slice active-agents)
        ...(input.permissionPolicy !== undefined
          ? { permissionPolicy: input.permissionPolicy }
          : {}),
        ...(input.parentAgentId !== undefined ? { parentAgentId: input.parentAgentId } : {}),
        ...(input.closeOnTurnEnd === true ? { closeOnTurnEnd: true } : {}),
        ...(input.notifyOnDone !== undefined && input.notifyOnDone !== ""
          ? { notifyOnDone: input.notifyOnDone }
          : {}),
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
