import { createInitialSessionState, type SessionState } from "@drive-coding/core/session"
import { classifySessionUpdate, type FrameAction } from "./frame-router"
import {
  EMPTY_TOOL_CONTEXT,
  type FrameData,
  projectSessionUpdate,
  type ToolContext,
} from "./session-view-projection"

export type ProjectionSink = {
  onHostRecreated?(): void
  beforeUpdate(update: unknown): void
  toolContext(update: unknown, actions: FrameAction[]): ToolContext
  applyFrame(frame: FrameData, publish: () => void): void
  endBatch(state: SessionState): void
}

// Owned by one view; contains that view's single authoritative state and delivery shell.
export class SessionViewDelivery {
  state: SessionState = createInitialSessionState({ sessionId: null })
  begin(sessionId: string | null, preserveControl = false): void {
    this.state = preserveControl
      ? {
          ...this.state,
          sessionId,
          messages: [],
          nextMessageSeq: 0,
          nextSegmentSeq: 0,
          carried: [],
        }
      : createInitialSessionState({ sessionId })
  }
  adopt(sessionId: string): void {
    this.state = { ...this.state, sessionId }
  }
  updatePending<K extends keyof SessionState["pending"]>(
    kind: K,
    value: SessionState["pending"][K],
  ): void {
    this.state = { ...this.state, pending: { ...this.state.pending, [kind]: value } }
  }
  #sink: ProjectionSink | undefined
  #uiStopped = false
  bind(sink: ProjectionSink): void {
    if (this.#uiStopped) throw new Error("Projection sink is terminal")
    this.#sink = sink
  }
  requireSink(): void {
    if (!this.#sink) throw new Error("SessionView requires an explicit projection sink")
  }
  dispose(): void {
    this.#sink = undefined
    this.#uiStopped = true
  }
  #ui<T>(remote: boolean, work: (sink: ProjectionSink) => T): T | undefined {
    const sink = this.#sink
    if (!sink || this.#uiStopped) return undefined
    try {
      return work(sink)
    } catch (error) {
      if (!remote) throw error
      this.#uiStopped = true
      return undefined
    }
  }
  update(
    raw: unknown,
    remote: boolean,
    version?: number,
    current: () => boolean = () => true,
    onCommit?: (frame: FrameData) => void,
  ): FrameData {
    this.requireSink()
    if (!current()) throw new Error("Obsolete view delivery")
    // HTTP reset is a structural frame before the legacy raw-update observer.
    if (
      remote &&
      typeof raw === "object" &&
      raw !== null &&
      (raw as { sessionUpdate?: unknown }).sessionUpdate === "_drive/reset"
    ) {
      const frame = this.#prepare(raw, [], EMPTY_TOOL_CONTEXT, version)
      const applied = this.frame(frame, true, current, onCommit)
      const actions =
        applied && current()
          ? this.#ui(true, (sink) => {
              sink.beforeUpdate(raw)
              return classifySessionUpdate({ update: raw })
            })
          : undefined
      // Keep the observed marker on the returned frame without publishing twice.
      // The already-delivered structural frame intentionally has actions=[].
      return actions === undefined ? frame : { ...frame, actions }
    }
    this.#ui(remote, (sink) => sink.beforeUpdate(raw))
    if (!current()) throw new Error("Obsolete view delivery")
    let actions: FrameAction[]
    // Classifier exceptions belonged to the old UI consumer, not the network producer.
    try {
      actions = classifySessionUpdate({ update: raw })
    } catch (error) {
      if (!remote) throw error
      this.#uiStopped = true
      actions = []
    }
    const context = this.#ui(remote, (sink) => sink.toolContext(raw, actions)) ?? EMPTY_TOOL_CONTEXT
    if (!current()) throw new Error("Obsolete view delivery")
    const frame = this.#prepare(raw, actions, context, version)
    this.frame(frame, remote, current, onCommit)
    return frame
  }
  #prepare(
    raw: unknown,
    actions: FrameAction[],
    context: ToolContext,
    version?: number,
  ): FrameData {
    // Producer calculation stays outside every UI error boundary.
    const candidate = projectSessionUpdate(this.state, raw, actions, context)
    return version === undefined
      ? candidate
      : {
          ...candidate,
          state: { ...candidate.state, version },
          patches: candidate.patches.map((patch) => ({ ...patch, version })),
        }
  }
  frame(
    frame: FrameData,
    remote: boolean,
    current: () => boolean = () => true,
    onCommit?: (frame: FrameData) => void,
  ): boolean {
    let published = false
    const publish = () => {
      if (published || !current()) return
      published = true
      this.state = frame.state
      onCommit?.(frame)
    }
    let applied = false
    if (!current()) return false
    if (frame.boundary === "host-recreated") this.#sink?.onHostRecreated?.()
    if (!current()) return false
    this.#ui(remote, (sink) => {
      sink.applyFrame(frame, publish)
      applied = true
    })
    // Local throw escapes before this line. Remote failure publishes the candidate
    // already calculated, once, and disables further UI delivery only.
    if (!published) publish()
    return applied && current()
  }
  endBatch(state: SessionState): void {
    this.#ui(true, (sink) => sink.endBatch(state))
  }
}

// Explicit standalone consumer; it uses the exact same producer path as the VM.
export function createProjectionRecorder(onFrame: (frame: FrameData) => void): ProjectionSink {
  return {
    beforeUpdate: () => {},
    toolContext: () => EMPTY_TOOL_CONTEXT,
    applyFrame: (frame, publish) => {
      publish()
      onFrame(frame)
    },
    endBatch: () => {},
  }
}
