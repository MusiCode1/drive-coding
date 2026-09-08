import { randomUUID } from "node:crypto"
import type { Agent, AgentRegistry, CreateAgentInput } from "@drive-coding/core"
import { validateCwd } from "@drive-coding/core"
import { buildAgentRow } from "./agent-row.js"

/**
 * AgentRegistry בזיכרון.
 * נאבד ב-restart אלא אם עוטפים ב-createPersistentAgentRegistry (persistent-registry.ts).
 * האם Thread-safe? כן, Bun ו-Node מריצים JS ב-thread יחיד.
 *
 * `seed` — שורות שנקראו מהדיסק ואומצו. נכנסות כמו שהן: הן כבר Agent מלא,
 * ולכן **לא** עוברות ב-buildAgentRow (שהיה דורס status/createdAt).
 * `onChange` — נקרא אחרי כל מוטציה; זה התפר שהעטיפה המתמידה נתלית עליו.
 */
export function createInMemoryAgentRegistry(opts?: {
  seed?: readonly Agent[]
  onChange?: () => void
}): AgentRegistry {
  const store = new Map<string, Agent>(opts?.seed?.map((a) => [a.id, a]))
  const changed = (): void => opts?.onChange?.()

  return {
    async create(input: CreateAgentInput): Promise<Agent> {
      // חגורה ושלייקס: אימות ה-cwd גם אם http-agents כבר בדק אותו.
      // מגן מפני קריאות ישירות ל-registry שעוקפות את שכבת ה-HTTP.
      const cwdResult = validateCwd(input.cwd)
      if (cwdResult.isErr()) {
        throw new Error(`invalid cwd: ${cwdResult.error.kind}`)
      }
      const agent = buildAgentRow({
        id: input.id ?? randomUUID(),
        cwd: cwdResult.value, // מנורמל
        createdAt: new Date().toISOString(),
        input,
      })
      store.set(agent.id, agent)
      changed()
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
      changed()
      return updated
    },

    async delete(id: string): Promise<void> {
      if (!store.has(id)) throw new Error(`Agent ${id} not found`)
      store.delete(id)
      changed()
    },
  }
}
