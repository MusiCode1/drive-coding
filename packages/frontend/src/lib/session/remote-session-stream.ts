import type { Patch, SessionState } from "@drive-coding/core/session"
import { getAgent } from "$lib/adapters/agents-api"
import type { ViewTerminal } from "./session-view"
import type { WireUpdateBatch } from "./wire/frame-decode"

export function snapshotResetPatch(snapshot: SessionState): Patch {
  return {
    version: snapshot.version,
    op: "reset",
    messages: snapshot.messages,
    nextMessageSeq: snapshot.nextMessageSeq,
    nextSegmentSeq: snapshot.nextSegmentSeq,
  }
}

export async function drainRemoteUpdates(
  stream: ReadableStream<WireUpdateBatch>,
  apply: (batch: WireUpdateBatch) => void,
): Promise<void> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      try {
        apply(value)
      } catch (error) {
        console.warn("RemoteSessionView: error applying patch, skipping", error)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function readTerminalEmission(
  agentId: string,
  signal: AbortSignal,
  opts: Parameters<typeof getAgent>[2],
): Promise<ViewTerminal | undefined> {
  if (signal.aborted) return
  try {
    const response = await getAgent(agentId, signal, opts)
    const reason = response?.agent?.crashReason
    if (!signal.aborted && typeof reason === "string" && reason.length > 0) {
      return { terminal: true, terminalError: reason }
    }
  } catch {
    // Agent metadata is optional once the stream has ended.
  }
  if (!signal.aborted) return { terminal: true }
}

export async function cancelPendingOnViewClose(
  { permission, elicitation }: SessionState["pending"],
  respond: (id: number, result: unknown) => Promise<void>,
): Promise<void> {
  // Reply while the pipe is still open so the host can resolve the pending requests.
  if (permission) {
    await respond(permission.requestId, { outcome: { outcome: "cancelled" } }).catch(() => {})
  }
  if (elicitation) {
    await respond(elicitation.requestId, { action: "cancel" }).catch(() => {})
  }
}
