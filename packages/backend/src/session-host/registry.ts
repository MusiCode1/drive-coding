/**
 * registry.ts — AgentSessionRegistry (S4 C1).
 *
 * Maps agentId → {host: ExtendedSessionHost, broadcaster: PatchesBroadcaster}.
 * Lazy creation: host + broadcaster are created on first getOrCreateHost call.
 *
 * Receives connectionRegistry in constructor — used to look up ProviderConnection
 * by agentId (returns undefined if connection not found → getOrCreateHost returns undefined).
 *
 * Ownership:
 *   - Registry creates one PatchesBroadcaster per host
 *   - Registry owns the lifecycle of both host and broadcaster
 *
 * Name is "AgentSessionRegistry" to distinguish from the existing `registry`
 * (InMemoryAgentRegistry) already used in server.ts.
 *
 * ─── slice session-host-http C1 (TDD) ───
 *
 * Auto session creation (slice remote-session-view, הכרעה 1, 2026-08-09):
 * ה-FE ב-remote mode אסור לו ליזום newSession/loadSession (הbackend מנהל sessions,
 * §5.1). לכן ברגע שה-host נוצר (lazy, בקריאה הראשונה) — הוא מקבל session אוטומטית
 * מ-host.newSession({cwd}), כך שה-snapshot הראשון שה-SSE שולח כבר נושא sessionId
 * אמיתי. cwd מגיע מ-connectionRegistry.getCwd(agentId) (נשמר ב-connect() המקורי).
 */

import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import { createPatchesBroadcaster, type PatchesBroadcaster } from "./patches-broadcaster.js"
import { createSessionHostFromConnection, type ExtendedSessionHost } from "./session-host.js"

type HostEntry = {
  host: ExtendedSessionHost
  broadcaster: PatchesBroadcaster
}

export type AgentSessionRegistry = {
  /**
   * getHost — returns the existing ExtendedSessionHost for agentId, or undefined.
   * Does NOT create a new host.
   */
  getHost(agentId: string): ExtendedSessionHost | undefined

  /**
   * getOrCreateHost — async lazy creation.
   * - If host already exists → returns {host, broadcaster}
   * - If connection not found in connectionRegistry → returns undefined
   * - Otherwise: creates host + broadcaster, registers them, returns {host, broadcaster}
   */
  getOrCreateHost(agentId: string): Promise<HostEntry | undefined>

  /**
   * getBroadcaster — returns the existing PatchesBroadcaster for agentId, or undefined.
   */
  getBroadcaster(agentId: string): PatchesBroadcaster | undefined

  /**
   * unregisterHost — removes host + broadcaster for agentId.
   * No-op if agentId is not registered.
   */
  unregisterHost(agentId: string): void
}

type AgentSessionRegistryDeps = {
  connectionRegistry: ConnectionRegistry
  /**
   * Injectable for tests — defaults to createSessionHostFromConnection.
   * Receives the ProviderConnection and returns a Promise<ExtendedSessionHost>.
   */
  _createHostFn?: (conn: ProviderConnection) => Promise<ExtendedSessionHost>
  /**
   * Injectable for tests — defaults to createPatchesBroadcaster.
   * Receives host.patches and returns a PatchesBroadcaster.
   */
  _createBroadcasterFn?: (patches: ExtendedSessionHost["patches"]) => PatchesBroadcaster
}

export function createAgentSessionRegistry(deps: AgentSessionRegistryDeps): AgentSessionRegistry {
  const {
    connectionRegistry,
    _createHostFn = (conn) => createSessionHostFromConnection(conn),
    _createBroadcasterFn = (patches) => createPatchesBroadcaster(patches),
  } = deps

  const map = new Map<string, HostEntry>()

  return {
    getHost(agentId: string): ExtendedSessionHost | undefined {
      return map.get(agentId)?.host
    },

    async getOrCreateHost(agentId: string): Promise<HostEntry | undefined> {
      // Return existing entry if already created
      const existing = map.get(agentId)
      if (existing) return existing

      // Look up connection
      const conn = connectionRegistry.get(agentId)
      if (!conn) return undefined

      // Create host + broadcaster
      const host = await _createHostFn(conn)
      const broadcaster = _createBroadcasterFn(host.patches)

      // Auto session creation (הכרעה 1): ה-host נולד בלי session — ניצור אחד עכשיו
      // כך שה-snapshot הראשון (SSE frame-zero) כבר נושא sessionId אמיתי.
      // אם כבר יש sessionId (למשל host הוזרק מוכן-לשימוש בבדיקות) — לא יוצרים שוב.
      if (!host.state.sessionId) {
        const cwd = connectionRegistry.getCwd(agentId)
        if (!cwd) {
          throw new Error(
            `AgentSessionRegistry: no cwd registered for agentId ${agentId} — cannot auto-create session`,
          )
        }
        await host.newSession({ cwd })
      }

      const entry: HostEntry = { host, broadcaster }
      map.set(agentId, entry)
      return entry
    },

    getBroadcaster(agentId: string): PatchesBroadcaster | undefined {
      return map.get(agentId)?.broadcaster
    },

    unregisterHost(agentId: string): void {
      map.delete(agentId)
    },
  }
}
