import { createLogger } from "@drive-coding/core/log"
import {
  applyPatch,
  type ChannelFrame,
  type ChannelResponse,
  type Patch,
  STREAM_ALIVE_EVENT,
  STREAM_ALIVE_INTERVAL_MS,
  STREAM_ALIVE_METHOD,
  snapshotFrame,
  updateFrame,
} from "@drive-coding/core/session"
import type { ConnectionRegistry, ConnectionVia } from "../../acp/connection-registry.js"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import { hostFailureResponse, hostThrowResponse } from "./host-failure.js"

const log = createLogger("backend.session-host.events")

export type FrameSink = { write(frame: ChannelFrame): Promise<void> }
export type ViewerTimers = {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

const defaultTimers: ViewerTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
}

export type OpenViewerInput = {
  agentId: string
  connectionId: string
  clientEpoch: number | undefined
  via: ConnectionVia
  snapshot?: "full" | "meta"
}
export type ViewerEnd = "ended" | "cancelled" | "failed"
export type OpenViewerResult =
  | { ok: false; response: ChannelResponse }
  | { ok: true; run(sink: FrameSink): Promise<ViewerEnd>; cancel(): void }

type OpenViewerDeps = {
  registry: AgentSessionRegistry
  connectionRegistry: ConnectionRegistry
  timers?: ViewerTimers
  /** @internal Test seam for a failure during snapshot construction. */
  _snapshotFrame?: typeof snapshotFrame
  _updateFrame?: typeof updateFrame
}

export async function openViewer(
  {
    registry,
    connectionRegistry,
    timers = defaultTimers,
    _snapshotFrame = snapshotFrame,
    _updateFrame = updateFrame,
  }: OpenViewerDeps,
  { agentId, connectionId, clientEpoch, via, snapshot: snapshotMode = "full" }: OpenViewerInput,
): Promise<OpenViewerResult> {
  // Reject stale epochs before triggering lazy host creation.
  if (clientEpoch !== undefined) {
    const serverEpoch = registry.getEpoch(agentId)
    if (clientEpoch < serverEpoch) {
      return {
        ok: false,
        response: { status: 409, body: { error: "taken-over", epoch: serverEpoch } },
      }
    }
  }

  let result: HostResult
  try {
    result = await registry.getOrCreateHost(agentId)
  } catch (err) {
    const response = hostThrowResponse(err)
    if (!response) throw err
    return { ok: false, response }
  }
  if (!result.ok) return { ok: false, response: hostFailureResponse(result) }
  const { host, broadcaster } = result.entry

  let reader: ReadableStreamDefaultReader<Patch> | undefined
  let cancelled = false
  let started = false
  let finished = false

  function cancel(): void {
    if (cancelled || finished) return
    cancelled = true
    void reader?.cancel().catch(() => {
      // The transport is already closing. run() still releases all viewer resources.
    })
  }

  async function run(sink: FrameSink): Promise<ViewerEnd> {
    if (cancelled) return "cancelled"
    if (started) return "failed"
    started = true

    let patchStream: ReadableStream<Patch> | undefined
    let clearKeepalive: (() => void) | undefined
    let end: ViewerEnd = "ended"

    async function write(frame: ChannelFrame): Promise<void> {
      try {
        await sink.write(frame)
      } catch {
        cancel()
      }
    }

    function cleanUp(action: () => void): void {
      try {
        action()
      } catch (err) {
        end = "failed"
        log.error({ err, agentId, connectionId }, "viewer cleanup failed")
      }
    }

    try {
      // Read the snapshot, subscribe at its version, and check the buffer
      // synchronously. Replay excludes patches already reflected in frame-zero.
      const snapshot = host.state
      patchStream = broadcaster.subscribe(snapshot.version)
      reader = patchStream.getReader()

      // This lower-bound guard detects eviction past snapshot.version. A hole
      // above the first buffered version is outside its scope. Recovery would
      // require sending another snapshot, so this path only reports the gap.
      const oldestBuffered = broadcaster.oldestBufferedVersion()
      if (oldestBuffered !== undefined && oldestBuffered > snapshot.version + 1) {
        log.warn(
          {
            agentId,
            snapshotVersion: snapshot.version,
            oldestBufferedVersion: oldestBuffered,
          },
          "patch buffer starts past the snapshot — the documented no-await-between-snapshot-and-subscribe assumption did not hold; this client is missing patches with no wire signal",
        )
      }

      connectionRegistry.addConnection(agentId, connectionId, via, patchStream)
      const currentEpoch = registry.getEpoch(agentId)

      // Keepalives go through the sink. Only inbound presence renews ownership.
      const keepalive = timers.setInterval(() => {
        if (cancelled || finished) return
        void write({
          event: STREAM_ALIVE_EVENT,
          data: JSON.stringify({ jsonrpc: "2.0", method: STREAM_ALIVE_METHOD, params: {} }),
        })
      }, STREAM_ALIVE_INTERVAL_MS)
      clearKeepalive = () => timers.clearInterval(keepalive)

      let view = snapshot
      await write(_snapshotFrame(snapshot, currentEpoch, snapshotMode))
      while (!cancelled) {
        const { done, value: patch } = await reader.read()
        if (cancelled) break
        if (done) break
        // Wire mapping needs the state directly after this patch. The live
        // host may already have applied a reset or changed the target message.
        view = applyPatch(view, patch)
        const frame = _updateFrame(view, patch, snapshotMode)
        if (frame !== null) await write(frame)
      }
    } catch (err) {
      end = "failed"
      log.error({ err, agentId, connectionId }, "viewer stream failed")
    } finally {
      finished = true
      cleanUp(() => clearKeepalive?.())
      cleanUp(() => reader?.releaseLock())
      if (patchStream !== undefined) {
        const stream = patchStream
        cleanUp(() => broadcaster.unsubscribe(stream))
        cleanUp(() =>
          connectionRegistry.removeConnection(agentId, connectionId, { onlyIfStream: stream }),
        )
      }
    }
    return end === "failed" ? end : cancelled ? "cancelled" : end
  }

  return { ok: true, run, cancel }
}
