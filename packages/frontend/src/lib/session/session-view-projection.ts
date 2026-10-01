import { type Patch, reduce, type SessionState } from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import { toPatches } from "./frame-router"
import type { ViewEmission, ViewFrame } from "./session-view"
import type { WireUpdateBatch } from "./sse-reader"

export async function missingLocalClient(): Promise<AcpClient> {
  throw new Error(
    "LocalSessionView: default production client factory not yet implemented. Pass `createClient` option or use C4 wiring.",
  )
}

export function createViewStream(
  setController: (controller: ReadableStreamDefaultController<ViewEmission>) => void,
): ReadableStream<ViewEmission> {
  return new ReadableStream<ViewEmission>({ start: setController })
}

export function closeViewStream(
  controller: ReadableStreamDefaultController<ViewEmission> | null,
): void {
  try {
    controller?.close()
  } catch {
    // A cancelled or already closed stream needs no further action.
  }
}

export function recoveringObserver(
  view: { emissionSequence: number; ingestUpdate: NonNullable<AcpClientCallbacks["onUpdate"]> },
  observer: Pick<AcpClientCallbacks, "onUpdate" | "onExtNotification">,
): Pick<AcpClientCallbacks, "onUpdate" | "onExtNotification"> {
  return {
    ...observer,
    onUpdate: (notification) => {
      const before = view.emissionSequence
      try {
        observer.onUpdate?.(notification)
      } catch {
        if (view.emissionSequence === before) view.ingestUpdate(notification)
      }
    },
  }
}

export function localClientCallbacks(
  observer: Pick<AcpClientCallbacks, "onUpdate" | "onExtNotification">,
  onRequestPermission: AcpClientCallbacks["onRequestPermission"],
  onCreateElicitation: AcpClientCallbacks["onCreateElicitation"],
): AcpClientCallbacks {
  return { ...observer, onRequestPermission, onCreateElicitation }
}

export function viewFrame(state: SessionState, update: unknown, corePatches: Patch[]): ViewFrame {
  return { rawUpdate: update, state, corePatches, displayIntents: toPatches({ update }) }
}

export function resetViewFrame(state: SessionState): ViewFrame {
  return {
    state,
    corePatches: [
      {
        version: state.version,
        op: "reset",
        messages: state.messages,
        nextMessageSeq: state.nextMessageSeq,
        nextSegmentSeq: state.nextSegmentSeq,
      },
    ],
    displayIntents: [],
  }
}

export function findResetPatch(patches: Patch[]): Extract<Patch, { op: "reset" }> | undefined {
  return patches.find((patch): patch is Extract<Patch, { op: "reset" }> => patch.op === "reset")
}

export function enqueueViewFrames(
  controller: ReadableStreamDefaultController<ViewEmission> | null,
  sessionToken: number,
  frames: ViewFrame[],
): boolean {
  if (!controller) return false
  try {
    controller.enqueue({
      sessionToken,
      frames,
      patches: frames.flatMap((frame) => frame.corePatches),
      updates: frames.flatMap((frame) => (frame.rawUpdate === undefined ? [] : [frame.rawUpdate])),
    })
    return true
  } catch {
    // The consumer has cancelled its reader.
    return false
  }
}

export function ingestLocalUpdate(
  controller: ReadableStreamDefaultController<ViewEmission> | null,
  sessionToken: number,
  state: SessionState,
  update: unknown,
): { state: SessionState; emitted: boolean } {
  const next = reduce(state, update)
  const emitted = enqueueViewFrames(controller, sessionToken, [
    viewFrame(next.state, update, next.patches),
  ])
  return { state: next.state, emitted }
}

export function emitLocalSdkMessage(
  controller: ReadableStreamDefaultController<ViewEmission> | null,
  sessionToken: number,
  state: SessionState,
  method: string,
  params: Record<string, unknown>,
): void {
  if (method !== "_claude/sdkMessage") return
  const update = { sessionUpdate: "_drive/ext_notification", method, params }
  enqueueViewFrames(controller, sessionToken, [viewFrame(state, update, [])])
}

export function projectRemoteBatch(
  state: SessionState,
  batch: WireUpdateBatch,
): {
  state: SessionState
  patches: Patch[]
  frames: ViewFrame[]
} {
  const patches: Patch[] = []
  const frames: ViewFrame[] = []
  let current = state
  for (const update of batch.updates) {
    const next = reduce(current, update)
    current = next.state
    patches.push(...next.patches)
    frames.push(viewFrame({ ...current, version: batch.version }, update, next.patches))
  }
  return { state: { ...current, version: batch.version }, patches, frames }
}
