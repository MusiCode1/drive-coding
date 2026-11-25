import type { SessionView } from "$lib/session/session-view"
import { formatAcpError } from "./format-acp-error"

export type ListedSessionInput = {
  sessionId: string
  cwd: string
  cliKind: string
  title?: string
  titleManual?: boolean
}

type SessionState = {
  readonly status: string
  cwd: string | null
  error: string | null
  isLoadingHistory: boolean
}

type SwitchDeps = {
  endScope(): void
  enterSession(id: string): void
  applyTitle(): void
}

export async function switchListedSession(
  state: SessionState,
  view: SessionView | null,
  input: ListedSessionInput,
  deps: SwitchDeps,
): Promise<void> {
  if (!view) throw new Error("cannot switchSession without a view")
  if (state.status !== "connected" || state.isLoadingHistory) {
    throw new Error(`cannot switchSession in status ${state.status}`)
  }
  deps.endScope()
  state.error = null
  state.isLoadingHistory = true
  try {
    await view.loadSession(input.sessionId, input.cwd)
    deps.enterSession(input.sessionId)
    state.cwd = input.cwd
    deps.applyTitle()
  } catch (e) {
    state.error = `switchSession failed: ${formatAcpError(e)}`
  } finally {
    state.isLoadingHistory = false
  }
}

type NewSessionDeps = Pick<SwitchDeps, "endScope" | "enterSession"> & {
  attach(cwd: string): Promise<void>
  clearSurfacedError(): void
  applyRememberedConfig(): Promise<void>
}

export async function newListedSession(
  state: SessionState & { sessionTitle: string },
  view: SessionView | null,
  input: { cwd?: string },
  deps: NewSessionDeps,
): Promise<void> {
  const cwd = input.cwd ?? state.cwd
  if (!cwd) throw new Error("newSession: no cwd")
  if (view && (state.status !== "connected" || state.isLoadingHistory)) {
    throw new Error(`cannot newSession in status ${state.status}`)
  }
  deps.endScope()
  if (!view) return deps.attach(cwd)
  state.error = null
  deps.clearSurfacedError()
  state.sessionTitle = ""
  state.isLoadingHistory = true
  try {
    await view.newSession(cwd)
    const newId = view.state.sessionId
    if (!newId) throw new Error("newSession returned no sessionId")
    deps.enterSession(newId)
    state.cwd = cwd
    await deps.applyRememberedConfig()
  } catch (e) {
    state.error = `newSession failed: ${formatAcpError(e)}`
  } finally {
    state.isLoadingHistory = false
  }
}
