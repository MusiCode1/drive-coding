import type { SessionModeState, SessionNotification } from "@agentclientprotocol/sdk"
import { createLogger } from "@drive-coding/core/log"
import {
  applyPatch,
  currentModeUpdate,
  type Patch,
  reduce,
  type SessionConfigOption,
  type SessionState,
  type ToolOutputRules,
  unclassifiedToolMetaKeys,
} from "@drive-coding/core/session"

const log = createLogger("backend.session-host.ingest")

export function publishResponseModes(
  handleUpdate: (notification: SessionNotification) => void,
  sessionId: string,
  modes: SessionModeState | null | undefined,
): void {
  if (modes) handleUpdate({ sessionId, update: currentModeUpdate(modes) })
}

export function configOptionsAfterLoad(
  configOptions: unknown,
  previous: SessionConfigOption[] | undefined,
): SessionConfigOption[] {
  const loaded = (Array.isArray(configOptions) ? configOptions : []) as SessionConfigOption[]
  // For the same session, a locally changed option is newer than a load reply.
  return previous
    ? loaded.map((opt) => previous.find((entry) => entry.id === opt.id) ?? opt)
    : loaded
}

export function createPatchChannel() {
  let controller: ReadableStreamDefaultController<Patch> | null = null
  const stream = new ReadableStream<Patch>({
    start(value) {
      controller = value
    },
    cancel() {
      controller = null
    },
  })

  return {
    stream,
    emit(patches: Patch[]) {
      if (!controller) return
      for (const patch of patches) {
        try {
          controller.enqueue(patch)
        } catch {
          // The reader has closed the stream.
        }
      }
    },
    close() {
      if (!controller) return
      try {
        controller.close()
      } catch {
        // The stream may have been cancelled before disposal.
      }
      controller = null
    },
  }
}

type UpdateIngestDeps = {
  isDisposed(): boolean
  getState(): SessionState
  emit(result: { state: SessionState; patches: Patch[] }): void
  toolOutputRules?: ToolOutputRules
  logger?: { warn(bindings: { key: string }, message: string): void }
}

export function createUpdateIngest({
  isDisposed,
  getState,
  emit,
  toolOutputRules,
  logger = log,
}: UpdateIngestDeps) {
  const warned = new Set<string>()
  const options = toolOutputRules ? { toolOutput: toolOutputRules } : undefined

  return {
    applySessionChanges(changes: Extract<Patch, { op: "update-session" }>["changes"]): void {
      const state = getState()
      const patch: Patch = { op: "update-session", version: state.version + 1, changes }
      emit({ state: applyPatch(state, patch), patches: [patch] })
    },

    handleUpdate(notification: SessionNotification): void {
      if (isDisposed()) return
      const state = getState()
      // During a session switch, only the incoming session's replay is accepted.
      // Legacy frames without a session ID can still arrive before initialization.
      const sid = notification.sessionId as string | undefined
      if (sid !== undefined && state.sessionId !== null && sid !== state.sessionId) return

      if (toolOutputRules) {
        for (const key of unclassifiedToolMetaKeys(toolOutputRules, notification.update)) {
          if (warned.has(key)) continue
          warned.add(key)
          logger.warn({ key }, "unclassified tool _meta key — add it to metaKeys")
        }
      }
      emit(reduce(state, notification.update, options))
    },

    handleExtNotification(method: string, params: Record<string, unknown>): void {
      if (isDisposed()) return
      emit(reduce(getState(), { sessionUpdate: "_drive/ext_notification", method, params }))
    },
  }
}
