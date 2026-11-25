import type { SessionState } from "@drive-coding/core/session"
import { unregisterView, type ViewDebugInfo } from "$lib/debug/session-registry"
import type { HistorySync } from "./history-sync"
import { cancelPendingOnViewClose } from "./remote-session-stream"
import type { FrameReader } from "./wire/frame-reader"
import type { SessionPipe } from "./wire/pipe"

export async function closeRemoteSession(
  view: ViewDebugInfo,
  opts: {
    state: SessionState
    setState: (s: SessionState) => void
    respond: (requestId: number, result: unknown) => Promise<void>
    history: HistorySync
    reader: FrameReader
    pipe: SessionPipe
    patchesCtrl: ReadableStreamDefaultController<unknown> | null
  },
): Promise<void> {
  const pending = opts.state.pending
  if (pending.permission || pending.elicitation) {
    await cancelPendingOnViewClose(pending, opts.respond)
  }
  opts.setState({ ...opts.state, pending: { permission: null, elicitation: null } })
  unregisterView(view)
  opts.history.close()
  opts.reader.close()
  opts.pipe.close()
  try {
    opts.patchesCtrl?.close()
  } catch {
    // already closed
  }
}