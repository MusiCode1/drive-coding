import type { NewSessionRequest, SessionNotification } from "@agentclientprotocol/sdk"
import type { Patch, SessionState } from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import { configOptionsAfterLoad, publishResponseModes } from "./session-host-ingest.js"
import { type createSessionSwitch, SWITCHING_SESSION_ID } from "./session-switch.js"

export type SessionMcpOpts = { mcpServers?: NewSessionRequest["mcpServers"] }

type NewSessionOptions = { cwd: string; _meta?: Record<string, unknown> } & SessionMcpOpts

export type LoadSessionOptions = NewSessionOptions & {
  sessionId: string
}

type SwitchActionDeps = {
  client: Pick<AcpClient, "newSession" | "loadSession">
  isDisposed(): boolean
  getState(): SessionState
  sessionSwitch: ReturnType<typeof createSessionSwitch>
  updateState(changes: Partial<SessionState>): void
  applySessionChanges(changes: Extract<Patch, { op: "update-session" }>["changes"]): void
  handleUpdate(notification: SessionNotification): void
  bumpQuotaGeneration(): void
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
  bumpQuotaGeneration,
  startQuotaFetch,
}: SwitchActionDeps) {
  async function coldNewSession(opts: Parameters<AcpClient["newSession"]>[0]) {
    const result = await client.newSession(opts)
    const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
    updateState({ sessionId: result.sessionId, configOptions })
    if (configOptions.length > 0) applySessionChanges({ configOptions })
    publishResponseModes(handleUpdate, result.sessionId, result.modes)
    bumpQuotaGeneration()
    startQuotaFetch(result.sessionId)
    return result
  }

  async function warmNewSession(opts: Parameters<AcpClient["newSession"]>[0]) {
    sessionSwitch.beginTransition()
    try {
      let reset: ReturnType<typeof sessionSwitch.emitSessionSwitchReset>
      try {
        sessionSwitch.beginPreFlip()
        // Flush pending handlers before reset. With neither pending, the ID
        // flips in this tick and the outgoing tail sees the sentinel.
        if (sessionSwitch.cancelOpenPendingSync()) await Promise.resolve()
        reset = sessionSwitch.emitSessionSwitchReset()
        updateState({ sessionId: SWITCHING_SESSION_ID, lastTurnError: null, stopReason: null })
      } finally {
        sessionSwitch.endPreFlip()
      }
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
        sessionSwitch.rollbackSessionSwitch(reset.oldSessionId, reset.snapshot)
        throw error
      }
    } finally {
      sessionSwitch.endTransition()
    }
  }

  return {
    newSession(opts: NewSessionOptions) {
      if (isDisposed()) return Promise.reject(new Error("SessionHost disposed"))
      const hadSession = getState().sessionId !== null
      const sessionOpts = { ...opts, mcpServers: opts.mcpServers ?? [] }
      return hadSession ? warmNewSession(sessionOpts) : coldNewSession(sessionOpts)
    },

    async loadSession(opts: LoadSessionOptions): Promise<{ sessionId: string; version: number }> {
      if (isDisposed()) throw new Error("SessionHost disposed")
      sessionSwitch.assertCanLoad(opts.sessionId)
      sessionSwitch.beginTransition()
      try {
        let reset: ReturnType<typeof sessionSwitch.emitSessionSwitchReset>
        try {
          sessionSwitch.beginPreFlip()
          if (sessionSwitch.cancelOpenPendingSync()) await Promise.resolve()
          reset = sessionSwitch.emitSessionSwitchReset()
          // Accept the new session's replay as soon as its ID is assigned.
          updateState({ sessionId: opts.sessionId, lastTurnError: null, stopReason: null })
        } finally {
          sessionSwitch.endPreFlip()
        }

        try {
          const result = await client.loadSession({
            ...opts,
            mcpServers: opts.mcpServers ?? [],
          })
          const isSameSession = opts.sessionId === reset.oldSessionId
          const mergedConfigOptions = configOptionsAfterLoad(
            result?.configOptions,
            isSameSession ? reset.preResetConfigOptions : undefined,
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
          sessionSwitch.rollbackSessionSwitch(reset.oldSessionId, reset.snapshot)
          throw err
        }
      } finally {
        sessionSwitch.endTransition()
      }
    },
  }
}
