import type { NewSessionRequest, SessionNotification } from "@agentclientprotocol/sdk"
import type { Patch, SessionState } from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import { configOptionsAfterLoad, publishResponseModes } from "./session-host-ingest.js"
import { type createSessionSwitch, SWITCHING_SESSION_ID } from "./session-switch.js"

export type LoadSessionOptions = {
  cwd: string
  sessionId: string
  _meta?: Record<string, unknown>
  mcpServers?: NewSessionRequest["mcpServers"]
}

type SwitchActionDeps = {
  client: Pick<AcpClient, "newSession" | "loadSession">
  isDisposed(): boolean
  getState(): SessionState
  sessionSwitch: ReturnType<typeof createSessionSwitch>
  updateState(changes: Partial<SessionState>): void
  applySessionChanges(changes: Extract<Patch, { op: "update-session" }>["changes"]): void
  handleUpdate(notification: SessionNotification): void
  startQuotaFetch(sessionId: string): void
}

export function createSessionHostSwitchActions({
  client,
  isDisposed,
  getState,
  sessionSwitch,
  updateState,
  applySessionChanges,
  handleUpdate,
  startQuotaFetch,
}: SwitchActionDeps) {
  return {
    async warmNewSession(opts: Parameters<AcpClient["newSession"]>[0]) {
      sessionSwitch.beginTransition()
      try {
        sessionSwitch.beginSessionSwitchInvalidate()
        if (sessionSwitch.cancelOpenPendingSync()) {
          // Let pending handlers publish their final patches before the reset.
          // With nothing pending, the reset and identity flip remain synchronous.
          await Promise.resolve()
        }
        const { oldSessionId, snapshot } = sessionSwitch.emitSessionSwitchReset()
        // An outgoing tail fails the identity filter while the provider assigns the new ID.
        updateState({ sessionId: SWITCHING_SESSION_ID, lastTurnError: null, stopReason: null })
        try {
          const result = await client.newSession(opts)
          const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
          updateState({ sessionId: result.sessionId, configOptions })
          applySessionChanges({
            turnState: "idle",
            lastTurnError: null,
            stopReason: null,
            quota: null,
            title: "",
            ...(configOptions.length > 0 ? { configOptions } : {}),
          })
          publishResponseModes(handleUpdate, result.sessionId, result.modes)
          startQuotaFetch(result.sessionId)
          return result
        } catch (error) {
          sessionSwitch.rollbackSessionSwitch(oldSessionId, snapshot)
          throw error
        }
      } finally {
        sessionSwitch.endTransition()
      }
    },

    async loadSession(opts: LoadSessionOptions): Promise<{ sessionId: string; version: number }> {
      if (isDisposed()) throw new Error("SessionHost disposed")
      sessionSwitch.assertCanLoad(opts.sessionId)
      sessionSwitch.beginTransition()
      try {
        sessionSwitch.beginSessionSwitchInvalidate()
        if (sessionSwitch.cancelOpenPendingSync()) {
          await Promise.resolve()
        }
        const { oldSessionId, preResetConfigOptions, snapshot } =
          sessionSwitch.emitSessionSwitchReset()

        // 4. Flip sessionId BEFORE the await — otherwise the step-5 filter would
        //    drop the new session's replay (arriving during the await; streamHistory
        //    runs inside the CLI's loadSession handler) and let in old-session tails.
        updateState({
          sessionId: opts.sessionId,
          lastTurnError: null,
          stopReason: null,
        })

        // 6.
        try {
          const result = await client.loadSession({
            ...opts,
            mcpServers: opts.mcpServers ?? [],
          })
          const isSameSession = opts.sessionId === oldSessionId
          const mergedConfigOptions = configOptionsAfterLoad(
            result?.configOptions,
            isSameSession ? preResetConfigOptions : undefined,
          )
          applySessionChanges({
            turnState: "idle",
            lastTurnError: null,
            stopReason: null,
            ...(mergedConfigOptions.length > 0 ? { configOptions: mergedConfigOptions } : {}),
            ...(isSameSession ? {} : { quota: null }),
          })
          publishResponseModes(handleUpdate, opts.sessionId, result?.modes)
          // slice http-state-gaps C3: the generation already advanced at entry (above).
          startQuotaFetch(opts.sessionId)
          return { sessionId: opts.sessionId, version: getState().version }
        } catch (err) {
          sessionSwitch.rollbackSessionSwitch(oldSessionId, snapshot)
          throw err
        }
      } finally {
        sessionSwitch.endTransition()
      }
    },
  }
}
