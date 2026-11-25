import type { Patch } from "@drive-coding/core/session"
import type { HistorySync } from "./history-sync"
import type { ViewTerminal } from "./session-view"
import { readTerminalEmission } from "./remote-session-stream"
import type { FrameReader } from "./wire/frame-reader"

export async function openRemoteSession(opts: {
  history: HistorySync
  reader: FrameReader
  applyOpening: (opening: Awaited<ReturnType<FrameReader["connect"]>>["opening"]) => void
  emit: (patches: Patch[], updates: unknown[], terminal?: ViewTerminal) => void
  agentId: string
  lifetime: AbortSignal
  agentMetadataOptions: Parameters<typeof readTerminalEmission>[2]
}): Promise<void> {
  const { history, reader, applyOpening, emit, agentId, lifetime, agentMetadataOptions } = opts
  history.beginParallelGet()
  const { opening, updates } = await reader.connect()
  history.setConnectionId(reader.currentConnectionId)
  applyOpening(opening)
  await history.finishOpen(opening)
  void history
    .start(updates)
    .then(() => readTerminalEmission(agentId, lifetime, agentMetadataOptions))
    .then((end) => {
      if (end && !lifetime.aborted) emit([], [], end)
    })
}