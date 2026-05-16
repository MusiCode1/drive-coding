import type { Agent, CreateAgentInput } from "./schemas"

/**
 * AgentRegistry — abstract storage לcollection של agents.
 * Slice 2: in-memory Map.
 * Slice 3+: יוסיף קישור ל-BridgeHandle.
 * [future]: אם נוסיף identity, נוסיף ownerId.
 */
export interface AgentRegistry {
  /** יוצר agent חדש. ב-Slice 2 stub status='ready' ישר. */
  create(input: CreateAgentInput): Promise<Agent>

  /** מחזיר agent לפי id, או null אם לא קיים. */
  get(id: string): Promise<Agent | null>

  /** רשימת כל ה-agents (no filter — אין identity ב-MVP). */
  list(): Promise<ReadonlyArray<Agent>>

  /** עדכון status / bridge details. throw אם id לא קיים. */
  update(
    id: string,
    patch: Partial<Pick<Agent, "status" | "bridgePort" | "acpSessionId">>,
  ): Promise<Agent>

  /** הסרה. throw אם לא קיים. */
  delete(id: string): Promise<void>
}
