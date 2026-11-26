import type { NewSessionRequest, SessionNotification } from "@agentclientprotocol/sdk"
import type { SessionState } from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import {
  configOptionsAfterLoad,
  type createUpdateIngest,
  publishResponseModes,
} from "./session-host-ingest.js"
import { type createSessionSwitch, SWITCHING_SESSION_ID } from "./session-switch.js"

export type SessionMcpOpts = { mcpServers?: NewSessionRequest["mcpServers"] }
type SessionOptions = { cwd: string; _meta?: Record<string, unknown> } & SessionMcpOpts

interface SwitchOperationDeps {
  client: Pick<AcpClient, "newSession" | "loadSession">
  sessionSwitch: ReturnType<typeof createSessionSwitch>
  state: SessionState
  isDisposed(): boolean
  applySessionChanges: ReturnType<typeof createUpdateIngest>["applySessionChanges"]
  handleUpdate(notification: SessionNotification): void
  bumpQuotaGeneration(): void
  startQuotaFetch(sessionId: string): void
}

export function createSessionHostSwitchOperations(deps: SwitchOperationDeps) {
  const { client, sessionSwitch, applySessionChanges, handleUpdate, startQuotaFetch } = deps

  return {
    /**
     * Cold create starts the first session. Warm create resets the transcript
     * and parks the ID on a sentinel until the CLI returns the new ID.
     */
    async newSession(opts: SessionOptions) {
      if (deps.isDisposed()) throw new Error("SessionHost disposed")
      const hadSession = deps.state.sessionId !== null
      const sessionOpts = { ...opts, mcpServers: opts.mcpServers ?? [] }

      if (!hadSession) {
        const result = await client.newSession(sessionOpts)
        const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
        deps.state = { ...deps.state, sessionId: result.sessionId, configOptions }
        if (configOptions.length > 0) applySessionChanges({ configOptions })
        publishResponseModes(handleUpdate, result.sessionId, result.modes)
        deps.bumpQuotaGeneration()
        startQuotaFetch(result.sessionId)
        return result
      }

      let reset: ReturnType<typeof sessionSwitch.emitSessionSwitchReset>
      try {
        sessionSwitch.beginPreFlip()
        // Flush pending cancellations before reset. Without pending work, keep
        // invalidation, reset and ID flip in the same tick.
        if (sessionSwitch.cancelOpenPendingSync()) await Promise.resolve()
        reset = sessionSwitch.emitSessionSwitchReset()
        // A sentinel filters outgoing tails while the CLI assigns the new ID.
        deps.state = { ...deps.state, sessionId: SWITCHING_SESSION_ID }
      } finally {
        sessionSwitch.endPreFlip()
      }

      try {
        const result = await client.newSession(sessionOpts)
        const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
        deps.state = { ...deps.state, sessionId: result.sessionId, configOptions }
        applySessionChanges({
          turnState: "idle",
          lastTurnError: null,
          quota: null,
          title: "",
          ...(configOptions.length > 0 ? { configOptions } : {}),
        })
        publishResponseModes(handleUpdate, result.sessionId, result.modes)
        startQuotaFetch(result.sessionId)
        return result
      } catch (err) {
        sessionSwitch.rollbackSessionSwitch(reset.oldSessionId, reset.snapshot)
        throw err
      }
    },

    async loadSession(opts: SessionOptions & { sessionId: string }) {
      if (deps.isDisposed()) throw new Error("SessionHost disposed")
      sessionSwitch.assertCanLoad(opts.sessionId)
      let reset: ReturnType<typeof sessionSwitch.emitSessionSwitchReset>
      try {
        sessionSwitch.beginPreFlip()
        if (sessionSwitch.cancelOpenPendingSync()) await Promise.resolve()
        reset = sessionSwitch.emitSessionSwitchReset()
        // Set the ID before requesting replay so the host accepts the new
        // session's updates and filters out tails from the previous session.
        deps.state = { ...deps.state, sessionId: opts.sessionId }
      } finally {
        sessionSwitch.endPreFlip()
      }

      try {
        const result = await client.loadSession({ ...opts, mcpServers: opts.mcpServers ?? [] })
        const isSameSession = opts.sessionId === reset.oldSessionId
        const mergedConfigOptions = configOptionsAfterLoad(
          result?.configOptions,
          isSameSession ? reset.preResetConfigOptions : undefined,
        )
        applySessionChanges({
          turnState: "idle",
          lastTurnError: null,
          ...(mergedConfigOptions.length > 0 ? { configOptions: mergedConfigOptions } : {}),
          ...(isSameSession ? {} : { quota: null }),
        })
        publishResponseModes(handleUpdate, opts.sessionId, result?.modes)
        startQuotaFetch(opts.sessionId)
        return { sessionId: opts.sessionId, version: deps.state.version }
      } catch (err) {
        sessionSwitch.rollbackSessionSwitch(reset.oldSessionId, reset.snapshot)
        throw err
      }
    },
  }
}
