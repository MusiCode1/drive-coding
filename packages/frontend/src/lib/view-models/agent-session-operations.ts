import type { AcpClient } from "@drive-coding/provider/client"
import type { Connection } from "$lib/session/connection"
import type { SessionView } from "$lib/session/session-view"
import type { captureSessionConfig } from "./agent-session-capture-config"
import { formatAcpError } from "./format-acp-error"
import type { SessionScope } from "./session-scoped-state.svelte"

type Status = "idle" | "connecting" | "connected" | "error" | "disconnected"
export type NewSessionInput = { cwd?: string; cliKind: string }
export type SwitchSessionInput = {
  sessionId: string
  cwd: string
  cliKind: string
  title?: string
  titleManual?: boolean
}
type ConfigResult = Parameters<typeof captureSessionConfig>[1]
export type OperationSnapshot = {
  status: Status
  cwd: string | null
  loading: boolean
  agentId: string | null
  client: AcpClient | null
  view: SessionView | null
  remoteView: SessionView | null
  connection: Connection | null
  detached: boolean
  tearingDown: boolean
}
export type SessionOperationOwner = { snapshot: OperationSnapshot; isCurrent(): boolean }
export type SessionWriteTarget = {
  scope: SessionScope
  sessionId: string | null
  isCurrent(): boolean
}
export type SessionOperationsDeps = {
  read(): OperationSnapshot
  scope(): SessionScope
  sessionId(): string | null
  attach(input: NewSessionInput & { cwd: string }): Promise<void>
  load(input: SwitchSessionInput): Promise<void>
  end(reason: "new" | "switch"): void
  status(status: Status): void
  resetError(): void
  error(message: string | null): void
  loading(value: boolean): void
  idle(): void
  resetTurn(): void
  clearTranscript(): void
  beginProjection(sessionId: string | null): void
  title(value: string): void
  cwd(value: string): void
  enter(sessionId: string): void
  adoptLocal(client: AcpClient, sessionId: string): void
  captureConfig(result: ConfigResult): void
  applyTitle(input: SwitchSessionInput): void
  meta(): Record<string, unknown> | undefined
  notify(agentId: string, sessionId: string, cwd: string): Promise<void>
  restore(target: SessionWriteTarget): Promise<void>
  isMock(sessionId: string): boolean
}

/** Imperative owner for hot transitions; epoch invalidates even a same-id/same-view reload. */
export function createSessionOperations(d: SessionOperationsDeps) {
  let epoch = 0
  function capture(transition = false): SessionOperationOwner {
    if (transition) epoch++
    const token = epoch
    const snapshot = d.read()
    return {
      snapshot,
      isCurrent: () => {
        const current = d.read()
        return (
          token === epoch &&
          !current.detached &&
          !current.tearingDown &&
          current.connection === snapshot.connection &&
          current.client === snapshot.client &&
          current.view === snapshot.view
        )
      },
    }
  }
  function captureTarget(owner = capture()): SessionWriteTarget {
    const scope = d.scope()
    const sessionId = d.sessionId()
    return {
      scope,
      sessionId,
      isCurrent: () =>
        owner.isCurrent() &&
        d.scope() === scope &&
        d.sessionId() === sessionId &&
        scope.sessionId === sessionId,
    }
  }
  function adopt(owner: SessionOperationOwner, id: string): SessionWriteTarget {
    d.enter(id)
    return captureTarget(owner)
  }
  async function notify(owner: SessionOperationOwner, id: string, cwd: string): Promise<void> {
    const agentId = owner.snapshot.agentId
    if (agentId) await d.notify(agentId, id, cwd).catch(() => {})
  }
  function current(owner: SessionOperationOwner, target?: SessionWriteTarget): boolean {
    return owner.isCurrent() && (target === undefined || target.isCurrent())
  }
  async function switchSession(input: SwitchSessionInput): Promise<void> {
    const state = d.read()
    if (state.remoteView) {
      if (state.status !== "connected" || state.loading)
        throw new Error(`cannot switchSession in status ${state.status}`)
      const owner = capture(true)
      if (!owner.isCurrent()) return
      d.end("switch")
      if (!owner.isCurrent()) return
      d.error(null)
      d.loading(true)
      let target: SessionWriteTarget | undefined
      try {
        await state.remoteView.loadSession(input.sessionId, input.cwd)
        if (!owner.isCurrent()) return
        target = adopt(owner, input.sessionId)
        if (!target?.isCurrent()) return
        d.cwd(input.cwd)
        d.applyTitle(input)
      } catch (error) {
        if (current(owner, target)) d.error(`switchSession failed: ${formatAcpError(error)}`)
      } finally {
        if (current(owner, target)) d.loading(false)
      }
      return
    }
    if (!state.client) return d.load(input)
    if (state.status !== "connected")
      throw new Error(`cannot switchSession in status ${state.status}`)
    if (d.isMock(input.sessionId)) return d.load(input)
    const owner = capture(true)
    if (!owner.isCurrent()) return
    d.resetTurn()
    d.end("switch")
    if (!owner.isCurrent()) return
    d.status("connecting")
    d.resetError()
    d.clearTranscript()
    d.beginProjection(input.sessionId)
    d.adoptLocal(state.client, input.sessionId)
    let target: SessionWriteTarget | undefined
    try {
      d.loading(true)
      try {
        const meta = d.meta()
        const result = await state.client.loadSession({
          sessionId: input.sessionId,
          cwd: input.cwd,
          mcpServers: [],
          ...(meta && { _meta: meta }),
        })
        if (!owner.isCurrent()) return
        d.captureConfig(result)
      } finally {
        if (owner.isCurrent()) {
          d.loading(false)
          d.idle()
        }
      }
      if (!owner.isCurrent()) return
      d.enter(input.sessionId)
      target = captureTarget(owner)
      if (!target.isCurrent()) return
      d.cwd(input.cwd)
      d.applyTitle(input)
      await notify(owner, input.sessionId, input.cwd)
      if (target?.isCurrent()) d.status("connected")
    } catch (error) {
      if (!current(owner, target)) return
      d.error(`switchSession failed: ${formatAcpError(error)}`)
      d.idle()
      d.status("error")
    }
  }
  async function newSession(input: NewSessionInput): Promise<void> {
    const state = d.read()
    if (state.remoteView) {
      if (state.status !== "connected" || state.loading)
        throw new Error(`cannot newSession in status ${state.status}`)
      const cwd = input.cwd ?? state.cwd
      if (!cwd) throw new Error("newSession: no cwd")
      const owner = capture(true)
      if (!owner.isCurrent()) return
      d.resetError()
      d.title("")
      d.loading(true)
      let target: SessionWriteTarget | undefined
      try {
        await state.remoteView.newSession(cwd)
        if (!owner.isCurrent()) return
        const id = state.remoteView.state.sessionId
        if (!id) throw new Error("newSession returned no sessionId")
        target = adopt(owner, id)
        if (!target?.isCurrent()) return
        d.cwd(cwd)
        await d.restore(target)
      } catch (error) {
        if (current(owner, target)) d.error(`newSession failed: ${formatAcpError(error)}`)
      } finally {
        if (current(owner, target)) d.loading(false)
      }
      return
    }
    const cwd = input.cwd ?? state.cwd
    if (!state.client) {
      if (!cwd) throw new Error("newSession: no cwd available for fallback attach")
      d.end("new")
      return d.attach({ cwd, cliKind: input.cliKind })
    }
    if (state.status !== "connected") throw new Error(`cannot newSession in status ${state.status}`)
    if (!cwd) throw new Error("newSession: no cwd")
    const owner = capture(true)
    if (!owner.isCurrent()) return
    d.end("new")
    if (!owner.isCurrent()) return
    d.status("connecting")
    d.resetError()
    d.clearTranscript()
    d.beginProjection(null)
    d.title("")
    let target: SessionWriteTarget | undefined
    try {
      const meta = d.meta()
      const result = await state.client.newSession({
        cwd,
        mcpServers: [],
        ...(meta && { _meta: meta }),
      })
      if (!owner.isCurrent()) return
      const id = (result as { sessionId?: string }).sessionId
      if (!id) throw new Error("newSession returned no sessionId")
      d.enter(id)
      d.cwd(cwd)
      d.adoptLocal(state.client, id)
      target = captureTarget(owner)
      if (!target.isCurrent()) return
      d.captureConfig(result)
      await notify(owner, id, cwd)
      if (!target?.isCurrent()) return
      d.status("connected")
      await d.restore(target)
    } catch (error) {
      if (!current(owner, target)) return
      d.error(`newSession failed: ${formatAcpError(error)}`)
      d.status("error")
    }
  }
  return {
    newSession,
    switchSession,
    captureTarget,
    invalidate: () => {
      epoch++
    },
  }
}
