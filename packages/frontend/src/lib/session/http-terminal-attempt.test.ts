import { afterEach, expect, it, vi } from "vitest"
import { createAgent } from "$lib/adapters/agents-api"
import { deferred, HttpStream, hostState } from "./__contract__/http-recovery-fixture"
import { createRemoteView } from "./create-session-view"
import { HttpConnection, type HttpConnectionDeps } from "./http-connection"
import { RemoteSessionView } from "./remote-session-view"
import type { RemoteTerminal } from "./remote-stream-events"
import { createProjectionRecorder } from "./session-view-delivery"

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn(async () => ({ agentId: "allocated" })),
}))
vi.mock("./create-session-view", () => ({ createRemoteView: vi.fn() }))
afterEach(() => vi.clearAllMocks())
const fact: RemoteTerminal = {
  kind: "terminal",
  source: { hostIncarnation: "host-A", token: {} },
  reason: "unavailable",
}
function deps() {
  return {
    prepare: vi.fn(),
    setAgent: vi.fn(),
    viewOptions: () => ({}),
    enterSession: vi.fn(),
    bindView: vi.fn(),
    applyTitle: vi.fn(),
    connected: vi.fn(async () => {}),
    rememberedConfig: vi.fn(async () => {}),
    failed: vi.fn(),
    missingSessionId: vi.fn(),
    terminal: vi.fn(),
    discardCreatedAgent: vi.fn(),
  } satisfies HttpConnectionDeps
}
it.each(["new", "existing-http"] as const)(
  "%s terminal before bind cannot adopt connected/config or delete allocated host",
  async (kind) => {
    const d = deps()
    const view = new RemoteSessionView("allocated", "http://fixture", {
      projection: createProjectionRecorder(() => {}),
    })
    vi.spyOn(view, "state", "get").mockReturnValue(hostState())
    const close = vi.spyOn(view, "close")
    vi.mocked(createRemoteView).mockImplementation(async (options, hooks) => {
      hooks?.onCreated?.(view)
      options.onTerminal?.(view, fact)
      hooks?.onReady?.(view)
      return view
    })
    const connection = new HttpConnection(d)
    await connection.open({ kind, agentId: "existing", cwd: "/tmp", cliKind: "claude" })
    expect(d.bindView).not.toHaveBeenCalled()
    expect(d.connected).not.toHaveBeenCalled()
    expect(d.rememberedConfig).not.toHaveBeenCalled()
    expect(d.discardCreatedAgent).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(d.terminal).toHaveBeenCalledTimes(1)
    await close.mockRestore()
    await view.close()
  },
)
it.each(["new", "existing-http"] as const)(
  "%s terminal after bind before factory return blocks connected/config",
  async (kind) => {
    const d = deps(),
      stream = new HttpStream(hostState())
    const view = new RemoteSessionView("allocated", "http://fixture", {
      projection: createProjectionRecorder(() => {}),
      _fetch: async () => stream.response,
    })
    await view.connect()
    vi.mocked(createRemoteView).mockImplementation(async (options, hooks) => {
      hooks?.onCreated?.(view)
      hooks?.onReady?.(view)
      options.onTerminal?.(view, fact)
      return view
    })
    try {
      await new HttpConnection(d).open({
        kind,
        agentId: "existing",
        cwd: "/tmp",
        cliKind: "claude",
      })
      expect(d.bindView).toHaveBeenCalledTimes(1)
      expect(d.connected).not.toHaveBeenCalled()
      expect(d.rememberedConfig).not.toHaveBeenCalled()
      expect(d.discardCreatedAgent).not.toHaveBeenCalled()
    } finally {
      await view.close()
      stream.end()
    }
  },
)
it("terminal marks captured attempt even after owner swap so stale allocation is never deleted", async () => {
  const d = deps(),
    done = deferred<void>()
  let bound = true
  const view = new RemoteSessionView("allocated", "http://fixture", {
    projection: createProjectionRecorder(() => {}),
  })
  vi.mocked(createRemoteView).mockImplementation(async (options, hooks) => {
    hooks?.onCreated?.(view)
    bound = false
    options.onTerminal?.(view, fact)
    await done.promise
    return view
  })
  const connection = new HttpConnection({ ...d, isBound: () => bound })
  const operation = connection.open({ kind: "new", cwd: "/tmp", cliKind: "claude" })
  await vi.waitFor(() => expect(createRemoteView).toHaveBeenCalled())
  done.resolve()
  await operation
  expect(d.terminal).not.toHaveBeenCalled()
  expect(d.discardCreatedAgent).not.toHaveBeenCalled()
  expect(createAgent).toHaveBeenCalledTimes(1)
  await view.close()
})
it("terminal during connected await blocks remembered config and deletion", async () => {
  const d = deps(),
    gate = deferred<void>()
  const stream = new HttpStream(hostState())
  const view = new RemoteSessionView("allocated", "http://fixture", {
    projection: createProjectionRecorder(() => {}),
    _fetch: async () => stream.response,
  })
  await view.connect()
  let terminal!: () => void
  vi.mocked(createRemoteView).mockImplementation(async (options, hooks) => {
    terminal = () => options.onTerminal?.(view, fact)
    hooks?.onCreated?.(view)
    hooks?.onReady?.(view)
    return view
  })
  d.connected.mockImplementation(() => gate.promise)
  try {
    const opening = new HttpConnection(d).open({ kind: "new", cwd: "/tmp", cliKind: "claude" })
    await vi.waitFor(() => expect(d.connected).toHaveBeenCalled())
    terminal()
    gate.resolve()
    await opening
    expect(d.rememberedConfig).not.toHaveBeenCalled()
    expect(d.discardCreatedAgent).not.toHaveBeenCalled()
  } finally {
    await view.close()
    stream.end()
  }
})
