import type { Patch } from "@drive-coding/core/session"
import type { HistorySync } from "./history-sync"
import { readTerminalEmission } from "./remote-session-stream"
import type { ViewTerminal } from "./session-view"
import type { WireUpdateBatch } from "./wire/frame-decode"
import type { FrameReader } from "./wire/frame-reader"

async function readToEnd(reader: ReadableStreamDefaultReader<WireUpdateBatch>): Promise<void> {
  try {
    while (!(await reader.read()).done) {
      // The other branch preserves the updates until the opening page is applied.
    }
  } finally {
    reader.releaseLock()
  }
}

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
  const emitTerminal = async () => {
    const end = await readTerminalEmission(agentId, lifetime, agentMetadataOptions)
    if (end && !lifetime.aborted) emit([], [], end)
  }

  history.beginParallelGet()
  const { opening, updates } = await reader.connect()
  history.setConnectionId(reader.currentConnectionId)
  applyOpening(opening)
  const ready = history.finishOpen(opening)

  if (!opening.historyOmitted) {
    await ready
    void history.start(updates).then(emitTerminal)
    return
  }

  const [buffered, endProbe] = updates.tee()
  const probe = endProbe.getReader()
  let opened: "ready" | "ended"
  try {
    opened = await Promise.race([
      ready.then(() => "ready" as const),
      readToEnd(probe).then(() => "ended" as const),
    ])
  } catch (error) {
    void buffered.cancel().catch(() => {})
    throw error
  } finally {
    if (endProbe.locked) void probe.cancel().catch(() => {})
  }

  if (opened === "ended") {
    void emitTerminal()
    void ready
      .then(() => history.start(buffered))
      .catch(() => buffered.cancel())
      .catch(() => {})
  } else {
    void history.start(buffered).then(emitTerminal)
  }
}
