import type { WireSessionUpdate } from "@drive-coding/core/session"
import { expect, it, vi } from "vitest"
import { hostState, textUpdate } from "./__contract__/http-recovery-fixture"
import { RemoteSessionReplacement } from "./remote-session-replacement"
import { RemoteStreamDelivery } from "./remote-stream-delivery"
import type { RemoteSnapshot, RemoteSource } from "./remote-stream-events"
import {
  createProjectionRecorder,
  type ProjectionSink,
  SessionViewDelivery,
} from "./session-view-delivery"
import type { FrameData } from "./session-view-projection"

const source = (hostIncarnation = "host-A"): RemoteSource => ({ hostIncarnation, token: {} })
const snap = (s: RemoteSource, version: number): RemoteSnapshot => ({
  kind: "snapshot",
  source: s,
  state: hostState(version),
})
function harness() {
  const frames: FrameData[] = []
  const delivery = new SessionViewDelivery(),
    replacement = new RemoteSessionReplacement()
  const end = vi.fn(),
    dispose = vi.fn(),
    terminal = vi.fn(),
    reconnect = vi.fn()
  const sink = { ...createProjectionRecorder((frame) => frames.push(frame)), endBatch: end }
  delivery.bind(sink)
  const ingress = new RemoteStreamDelivery({
    delivery,
    replacement,
    dispose,
    terminal,
    reconnected: reconnect,
    adoptSession: () => {},
  })
  const a = source()
  ingress.prime(snap(a, 43))
  ingress.snapshot(snap(a, 43), true)
  frames.length = 0
  end.mockClear()
  return { ingress, delivery, replacement, frames, end, dispose, terminal, reconnect, a, sink }
}
it("new source/version namespace admits 13 then 17 once; old source update and terminal are inert", () => {
  const h = harness(),
    b = source("host-B")
  h.ingress.snapshot(snap(b, 13))
  h.ingress.event({
    kind: "update",
    source: b,
    batch: { version: 17, updates: [textUpdate("once")] },
  })
  h.ingress.event({
    kind: "update",
    source: b,
    batch: { version: 17, updates: [textUpdate("duplicate")] },
  })
  h.ingress.event({
    kind: "update",
    source: h.a,
    batch: { version: 99, updates: [textUpdate("obsolete")] },
  })
  h.ingress.terminal({ kind: "terminal", source: h.a, reason: "unavailable" })
  expect(h.delivery.state.version).toBe(17)
  expect(h.delivery.state.messages).toHaveLength(1)
  expect(JSON.stringify(h.delivery.state.messages)).toContain("once")
  expect(JSON.stringify(h.delivery.state.messages)).not.toMatch(/duplicate|obsolete/)
  expect(h.frames[0]?.boundary).toBe("host-recreated")
  expect(h.ingress.closed).toBe(false)
})
it.each([43, 13])(
  "same incarnation reconnect version %i preserves state, reset/history and watermark",
  (version) => {
    const h = harness(),
      b = source()
    const state = h.delivery.state
    h.ingress.snapshot(snap(b, version))
    expect(h.delivery.state).toBe(state)
    expect(h.frames).toEqual([])
    expect(h.ingress.lastVersion).toBe(43)
    h.ingress.event({
      kind: "update",
      source: b,
      batch: { version: 44, updates: [textUpdate("live")] },
    })
    expect(h.delivery.state.version).toBe(44)
  },
)
it.each(["beforeUpdate", "toolContext", "applyFrame"] as const)(
  "close reentrancy inside %s prevents publication, tail and endBatch",
  (point) => {
    const h = harness()
    let called = 0
    const sink: ProjectionSink = {
      ...h.sink,
      [point]: (...args: unknown[]) => {
        called++
        h.ingress.beginClose()
        if (point === "applyFrame") (args[1] as () => void)()
        if (point === "toolContext")
          return { mappedChildExists: false, parentExists: false, childAlreadyTopLevel: false }
      },
    }
    h.delivery.bind(sink)
    try {
      h.ingress.event({
        kind: "update",
        source: h.a,
        batch: { version: 44, updates: [textUpdate("blocked"), textUpdate("tail")] },
      })
    } catch (error) {
      expect(String(error)).toContain("Obsolete")
    }
    expect(called).toBe(1)
    expect(h.delivery.state.version).toBe(43)
    expect(h.delivery.state.messages).toEqual([])
    expect(h.end).not.toHaveBeenCalled()
  },
)
it("owner swap in applyFrame stops old fallback and tail after a new snapshot committed", () => {
  const h = harness(),
    b = source("host-B")
  let swapped = false
  h.delivery.bind({
    ...h.sink,
    applyFrame: (frame, publish) => {
      if (!swapped) {
        swapped = true
        h.ingress.snapshot(snap(b, 13))
        publish()
        return
      }
      h.sink.applyFrame(frame, publish)
    },
  })
  h.ingress.event({
    kind: "update",
    source: h.a,
    batch: { version: 44, updates: [textUpdate("old"), textUpdate("tail")] },
  })
  expect(h.delivery.state.version).toBe(13)
  expect(h.delivery.state.messages).toEqual([])
  expect(h.end).toHaveBeenCalledTimes(1)
})
it("UI failure preserves canonical progress and control/terminal without reviving observer", () => {
  const h = harness()
  const observer = vi.fn(() => {
    throw new Error("UI failure")
  })
  h.delivery.bind({ ...h.sink, beforeUpdate: observer })
  h.ingress.event({
    kind: "update",
    source: h.a,
    batch: { version: 44, updates: [textUpdate("canonical")] },
  })
  expect(h.delivery.state.version).toBe(44)
  h.ingress.terminal({ kind: "terminal", source: h.a, reason: "taken-over" })
  expect(h.delivery.state.turnState).toBe("idle")
  expect(observer).toHaveBeenCalledTimes(1)
  expect(h.terminal).toHaveBeenCalledTimes(1)
  expect(h.dispose).toHaveBeenCalledTimes(1)
})
it("replacement is consumed only on commit; reentrant intent survives captured commit", async () => {
  const h = harness()
  let finish!: () => void
  const operation = h.replacement.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const first = h.replacement.capture()
  const prepared = h.replacement.prepareSnapshot(hostState(44), false)
  expect(prepared.intent).toBe(first)
  expect(h.replacement.capture()).toBe(first)
  h.delivery.bind({
    ...h.sink,
    applyFrame: (frame, publish) => {
      void h.replacement.run(async () => {})
      publish()
      throw new Error("after publication")
    },
  })
  h.ingress.snapshot(snap(source(), 44))
  expect(h.replacement.capture()).not.toBe(first)
  expect(h.replacement.capture()).toBeDefined()
  expect(h.delivery.state.version).toBe(44)
  finish()
  await operation
})
it("invalidated snapshot preparation does not consume replacement intent", async () => {
  const h = harness()
  const operation = h.replacement.run(async () => {})
  const intent = h.replacement.capture()
  h.delivery.bind({
    ...h.sink,
    applyFrame: () => {
      h.ingress.beginClose()
    },
  })
  h.ingress.snapshot(snap(source(), 44))
  expect(h.replacement.capture()).toBe(intent)
  expect(h.delivery.state.version).toBe(43)
  await operation
})
it("producer throw keeps committed reset prefix as an intent barrier, without swallowing failure", async () => {
  const h = harness()
  let reject!: (error: Error) => void
  const operation = h.replacement
    .run(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no
        }),
    )
    .catch(() => {})
  const fault = {
    get sessionUpdate(): string {
      throw new Error("producer fault")
    },
  } as WireSessionUpdate
  expect(() =>
    h.ingress.event({
      kind: "update",
      source: h.a,
      batch: {
        version: 44,
        updates: [
          { sessionUpdate: "_drive/reset", messages: [], nextMessageSeq: 0, nextSegmentSeq: 0 },
          fault,
        ],
      },
    }),
  ).toThrow("producer fault")
  expect(h.delivery.state.version).toBe(44)
  expect(h.replacement.capture()).toBeUndefined()
  reject(new Error("late RPC rejection"))
  await operation
  expect(h.replacement.capture()).toBeUndefined()
})
it("terminal cleanup is once even when terminal observer closes reentrantly and throws", () => {
  const h = harness()
  h.terminal.mockImplementation(() => {
    h.ingress.beginClose()
    throw new Error("terminal callback")
  })
  const terminal = { kind: "terminal" as const, source: h.a, reason: "unavailable" as const }
  h.ingress.terminal(terminal)
  h.ingress.terminal(terminal)
  expect(h.dispose).toHaveBeenCalledTimes(1)
  expect(h.terminal).toHaveBeenCalledTimes(1)
  expect(h.delivery.state.status).toBe("disconnected")
})
