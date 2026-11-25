import { createInitialSessionState, type Patch, type SessionState } from "@drive-coding/core/session"
import { describe, expect, it, vi } from "vitest"
import type { ConnectionRegistry } from "../../acp/connection-registry.js"
import type { PatchesBroadcaster } from "../patches-broadcaster.js"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import type { ExtendedSessionHost } from "../session-host.js"
import { type FrameSink, type OpenViewerInput, openViewer } from "./viewer-stream.js"

type ViewerDeps = Parameters<typeof openViewer>[0]

function setup(overrides: Partial<ViewerDeps> = {}) {
  let patches!: ReadableStreamDefaultController<Patch>
  const cancelReader = vi.fn()
  const patchStream = new ReadableStream<Patch>({
    start(controller) {
      patches = controller
    },
    cancel: cancelReader,
  })
  const unsubscribe = vi.fn()
  const broadcaster = {
    subscribe: vi.fn(() => patchStream),
    oldestBufferedVersion: vi.fn(() => undefined),
    unsubscribe,
    close: vi.fn(),
  } satisfies PatchesBroadcaster
  const host = {
    state: createInitialSessionState({ sessionId: "test-session" }),
  } as unknown as ExtendedSessionHost
  let epoch = 3
  const getOrCreateHost = vi.fn<() => Promise<HostResult>>().mockResolvedValue({
    ok: true,
    entry: { host, broadcaster },
  })
  const registry = { getEpoch: () => epoch, getOrCreateHost } as unknown as AgentSessionRegistry
  const addConnection = vi.fn()
  const removeConnection = vi.fn()
  const connectionRegistry = { addConnection, removeConnection } as unknown as ConnectionRegistry
  const write = vi.fn<FrameSink["write"]>().mockResolvedValue(undefined)
  let tick!: () => void
  const clearInterval = vi.fn()
  const timers = {
    setInterval(fn: () => void) {
      tick = fn
      return 42
    },
    clearInterval,
  }
  const deps = { registry, connectionRegistry, timers, ...overrides }
  const input = {
    agentId: "agent",
    connectionId: "viewer",
    clientEpoch: undefined,
    via: "ws",
  } satisfies OpenViewerInput

  async function open() {
    const result = await openViewer(deps, input)
    if (!result.ok) throw new Error("viewer should have opened")
    return result
  }

  function expectCleaned() {
    expect(clearInterval).toHaveBeenCalledExactlyOnceWith(42)
    expect(patchStream.locked).toBe(false)
    expect(unsubscribe).toHaveBeenCalledExactlyOnceWith(patchStream)
    expect(removeConnection).toHaveBeenCalledExactlyOnceWith("agent", "viewer", {
      onlyIfStream: patchStream,
    })
  }

  return {
    addConnection,
    cancelReader,
    deps,
    expectCleaned,
    getOrCreateHost,
    input,
    open,
    patches,
    patchStream,
    setEpoch: (next: number) => {
      epoch = next
    },
    tick: () => tick(),
    write,
  }
}

describe("openViewer", () => {
  it("rejects a stale epoch before attempting to obtain a host", async () => {
    const { deps, input, getOrCreateHost } = setup()
    expect(await openViewer(deps, { ...input, clientEpoch: 2 })).toEqual({
      ok: false,
      response: { status: 409, body: { error: "taken-over", epoch: 3 } },
    })
    expect(getOrCreateHost).not.toHaveBeenCalled()
  })

  it("streams snapshot, update and timer tick, then ends despite a newer epoch", async () => {
    const h = setup()
    const viewer = await h.open()
    const done = viewer.run({ write: h.write })

    h.patches.enqueue({ version: 1, op: "update-session", changes: { title: "New title" } })
    await vi.waitFor(() => expect(h.write).toHaveBeenCalledTimes(2))
    h.tick()
    h.setEpoch(4)
    h.patches.close()
    expect(await done).toBe("ended")
    expect(h.addConnection).toHaveBeenCalledExactlyOnceWith("agent", "viewer", "ws", h.patchStream)
    const frames = h.write.mock.calls.map(([frame]) => frame)
    expect(frames.map((frame) => frame.event)).toEqual(["snapshot", "update", "stream-alive"])
    expect(JSON.parse(frames[0]?.data ?? "null")).toMatchObject({
      sessionId: "test-session",
      epoch: 3,
    })
    expect(JSON.parse(frames[1]?.data ?? "null")).toMatchObject([
      { params: { update: { title: "New title" } } },
    ])
    expect(frames[2]).not.toHaveProperty("id")
    h.expectCleaned()
  })

  it("ends normally when the epoch is unchanged and ignores late cancellation", async () => {
    const h = setup()
    const viewer = await h.open()
    const done = viewer.run({ write: h.write })
    h.patches.close()
    expect(await done).toBe("ended")
    expect(() => viewer.cancel()).not.toThrow()
    expect(h.cancelReader).not.toHaveBeenCalled()
    h.expectCleaned()
  })

  it("cancels during the snapshot write even if the epoch advanced", async () => {
    const h = setup()
    const viewer = await h.open()
    let completeSnapshot!: () => void
    h.write.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        completeSnapshot = resolve
      }),
    )
    const done = viewer.run({ write: h.write })
    h.setEpoch(4)
    viewer.cancel()
    viewer.cancel()
    expect(h.cancelReader).toHaveBeenCalledTimes(1)
    completeSnapshot()
    expect(await done).toBe("cancelled")
    expect(h.write).toHaveBeenCalledTimes(1)
    h.expectCleaned()
  })

  it("avoids registering a viewer cancelled before run", async () => {
    const h = setup()
    const viewer = await h.open()
    viewer.cancel()
    expect(await viewer.run({ write: h.write })).toBe("cancelled")
    expect(h.write).not.toHaveBeenCalled()
    expect(h.addConnection).not.toHaveBeenCalled()
  })

  it("cleans up when the sink rejects the snapshot", async () => {
    const h = setup()
    const viewer = await h.open()
    h.write.mockRejectedValueOnce(new Error("viewer closed"))
    expect(await viewer.run({ write: h.write })).toBe("cancelled")
    h.expectCleaned()
  })

  it("cleans up when the sink rejects a keepalive", async () => {
    const h = setup()
    const viewer = await h.open()
    h.write.mockImplementation(async (frame) => {
      if (frame.event === "stream-alive") throw new Error("viewer closed")
    })
    const done = viewer.run({ write: h.write })
    h.tick()
    expect(await done).toBe("cancelled")
    h.expectCleaned()
  })

  it("meta snapshot matches for sse and ws viewers", async () => {
    const h = setup()
    const hostState: SessionState = {
      ...createInitialSessionState({ sessionId: "test-session" }),
      version: 5,
      title: "parity",
      messages: [
        {
          id: "m_0",
          role: "user",
          messageId: "u-0",
          segments: [{ id: "s_0", text: "hello" }],
        },
      ],
      nextMessageSeq: 1,
    }
    const capture = async (via: "http" | "ws") => {
      const local = setup()
      local.getOrCreateHost.mockResolvedValue({
        ok: true,
        entry: {
          host: { state: hostState } as unknown as ExtendedSessionHost,
          broadcaster: {
            subscribe: vi.fn(() => new ReadableStream({ start() {} })),
            oldestBufferedVersion: vi.fn(),
            unsubscribe: vi.fn(),
            close: vi.fn(),
          },
        },
      })
      let snapshotData: string | undefined
      const opened = await openViewer(local.deps, { ...local.input, via, snapshot: "meta" })
      if (!opened.ok) throw new Error("viewer should open")
      const done = opened.run({
        write: async (frame) => {
          if (frame.event === "snapshot" && snapshotData === undefined) {
            snapshotData = frame.data
            opened.cancel()
          }
        },
      })
      await done
      return snapshotData
    }

    expect(await capture("http")).toEqual(await capture("ws"))
  })

  it("reports an internal snapshot error and still cleans up", async () => {
    const h = setup({
      _snapshotFrame: () => {
        throw new Error("snapshot failed")
      },
    })
    const viewer = await h.open()
    expect(await viewer.run({ write: h.write })).toBe("failed")
    expect(h.write).not.toHaveBeenCalled()
    h.expectCleaned()
  })
})
