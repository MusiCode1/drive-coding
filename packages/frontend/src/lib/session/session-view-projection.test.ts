import * as sessionCore from "@drive-coding/core/session"
import { createInitialSessionState, type SessionState } from "@drive-coding/core/session"
import { describe, expect, it, vi } from "vitest"
import { classifySessionUpdate } from "./frame-router"
import { LocalSessionView } from "./local-session-view"
import { RemoteSessionReplacement } from "./remote-session-replacement"
import { createProjectionRecorder, SessionViewDelivery } from "./session-view-delivery"
import {
  EMPTY_TOOL_CONTEXT,
  projectSessionSnapshot,
  projectSessionUpdate,
} from "./session-view-projection"

const chunk = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}
describe("pure frame projector", () => {
  it("preserves input and raw/action references", () => {
    const state = freeze(createInitialSessionState({ sessionId: "s" })),
      raw = freeze(chunk),
      actions = freeze(classifySessionUpdate({ update: raw }))
    const f = projectSessionUpdate(state, raw, actions, EMPTY_TOOL_CONTEXT)
    expect(f.rawUpdate).toBe(raw)
    expect(f.actions).toBe(actions)
    expect(state.messages).toHaveLength(0)
    expect(f.state.messages).toHaveLength(1)
  })
  for (const name of ["agent_message_chunk", "agent_thought_chunk", "user_message_chunk"])
    it(`projects ${name}`, () => {
      const raw = { ...chunk, sessionUpdate: name }
      const f = projectSessionUpdate(
        createInitialSessionState({ sessionId: "s" }),
        raw,
        classifySessionUpdate({ update: raw }),
        EMPTY_TOOL_CONTEXT,
      )
      expect(f.state.messages).toHaveLength(1)
      expect(f.patches[0]?.op).toBe("add-message")
    })
  it("nested disposition skips top-level reduction with map precedence", () => {
    const raw = {
      sessionUpdate: "tool_call_update",
      toolCallId: "child",
      status: "completed",
      _meta: { claudeCode: { parentToolUseId: "metadata-parent" } },
    }
    const state = createInitialSessionState({ sessionId: "s" })
    const f = projectSessionUpdate(state, raw, classifySessionUpdate({ update: raw }), {
      mappedParent: "map-parent",
      mappedChildExists: false,
      parentExists: false,
      childAlreadyTopLevel: false,
    })
    expect(f.state).toBe(state)
    expect(f.patches).toEqual([])
    expect(f.toolDisposition).toBe("nested-update")
  })
  it("snapshot retains top-level child and explicit reset origin", () => {
    const state = createInitialSessionState({ sessionId: "s" })
    const f = projectSessionSnapshot(state, true, "same-session-reconnect")
    expect(f.state).toBe(state)
    expect(f.patches[0]?.op === "reset" && f.patches[0].messages).toBe(state.messages)
    expect(f.resetOrigin).toBe("same-session-reconnect")
    expect(projectSessionSnapshot(state, true).resetOrigin).toBeUndefined()
  })
  it("tool wrapper preserves raw input/output metadata aliases", () => {
    const raw = {
      sessionUpdate: "tool_call",
      toolCallId: "t",
      rawInput: { a: 1 },
      rawOutput: { b: 2 },
      _meta: { tag: {} },
    }
    const f = projectSessionUpdate(
      createInitialSessionState({ sessionId: "s" }),
      raw,
      classifySessionUpdate({ update: raw }),
      EMPTY_TOOL_CONTEXT,
    )
    expect(f.rawUpdate).toBe(raw)
    expect(f.toolDisposition).toBe("top-create")
    const m = f.state.messages[0]
    expect(m?.role === "tool" && m.toolCall.args).toBe(raw.rawInput)
  })
})
describe("delivery publication boundaries", () => {
  for (const afterPublish of [false, true])
    it(`local writer throw afterPublish=${afterPublish}`, () => {
      const d = new SessionViewDelivery()
      const before = d.state
      const failure = new Error("writer")
      d.bind({
        ...createProjectionRecorder(() => {}),
        applyFrame(_f, publish) {
          if (afterPublish) publish()
          throw failure
        },
      })
      expect(() => d.update(chunk, false)).toThrow(failure)
      expect(d.state.messages.length).toBe(afterPublish ? 1 : 0)
      if (!afterPublish) expect(d.state).toBe(before)
    })
  it("observer throw is local before activity/producer publication", () => {
    const d = new SessionViewDelivery()
    const before = d.state,
      activity = vi.fn()
    d.bind({
      ...createProjectionRecorder(() => {}),
      beforeUpdate() {
        throw new Error("observer")
      },
      toolContext() {
        activity()
        return EMPTY_TOOL_CONTEXT
      },
    })
    expect(() => d.update(chunk, false)).toThrow("observer")
    expect(d.state).toBe(before)
    expect(activity).not.toHaveBeenCalled()
  })
  it("remote UI failure publishes exactly one candidate and never invokes UI again", () => {
    const d = new SessionViewDelivery(),
      observe = vi.fn(() => {
        throw Error("UI")
      }),
      writer = vi.fn()
    d.bind({ ...createProjectionRecorder(writer), beforeUpdate: observe })
    d.update(chunk, true, 10)
    d.update(chunk, true, 11)
    expect(observe).toHaveBeenCalledOnce()
    expect(writer).not.toHaveBeenCalled()
    expect(d.state.version).toBe(11)
    expect(d.state.messages[0]?.role === "assistant" && d.state.messages[0].segments).toHaveLength(
      2,
    )
  })
  it("nullish local input is observed before classification throws", () => {
    const d = new SessionViewDelivery(),
      observed = vi.fn()
    d.bind({ ...createProjectionRecorder(() => {}), beforeUpdate: observed })
    expect(() => d.update(null, false)).toThrow(TypeError)
    expect(observed).toHaveBeenCalledWith(null)
    expect(d.state.messages).toHaveLength(0)
  })
})
function deferred() {
  let reject!: (e: Error) => void
  const promise = new Promise<void>((_r, no) => {
    reject = no
  })
  return { promise, reject }
}
describe("replacement owner terminal obligations", () => {
  it("consumed remains terminal through late catch even behind a newer record", async () => {
    const owner = new RemoteSessionReplacement()
    await owner.run(async () => {})
    const a = deferred(),
      b = deferred(),
      pa = owner.run(() => a.promise).catch((e) => e),
      captured = owner.capture(),
      pb = owner.run(() => b.promise).catch((e) => e)
    owner.consume(captured)
    a.reject(Error("a"))
    await pa
    expect(captured?.state).toBe("consumed")
    b.reject(Error("b"))
    await pb
    expect(owner.capture()).toBeUndefined()
  })
  it("failed old record behind current cannot be restored", async () => {
    const owner = new RemoteSessionReplacement(),
      a = deferred(),
      b = deferred(),
      pa = owner.run(() => a.promise).catch((e) => e),
      pb = owner.run(() => b.promise).catch((e) => e)
    a.reject(Error("a"))
    await pa
    b.reject(Error("b"))
    await pb
    expect(owner.capture()).toBeUndefined()
  })
  it("producer failure does not consume obligation", async () => {
    const owner = new RemoteSessionReplacement()
    await owner.run(async () => {})
    const capture = owner.capture()
    const bad = new Proxy({} as SessionState, {
      get() {
        throw Error("producer fault")
      },
    })
    expect(() => owner.projectSnapshot(bad, false)).toThrow("producer fault")
    expect(owner.capture()).toBe(capture)
  })
})

it("LocalSessionView reduces each raw once and publishes synchronously", () => {
  const frames = vi.fn(),
    view = new LocalSessionView({
      cwd: "/synthetic",
      cliKind: "claude",
      projection: createProjectionRecorder(frames),
    })
  const spy = vi.spyOn(sessionCore, "reduce")
  try {
    view.ingestUpdate(chunk)
    expect(spy).toHaveBeenCalledOnce()
    expect(view.state.messages).toHaveLength(1)
    expect(frames).toHaveBeenCalledOnce()
    view.ingestUpdate(chunk)
    expect(spy).toHaveBeenCalledTimes(2)
    const m = view.state.messages[0]
    expect(m?.role === "assistant" && m.segments).toHaveLength(2)
  } finally {
    spy.mockRestore()
    view.dispose()
  }
})
