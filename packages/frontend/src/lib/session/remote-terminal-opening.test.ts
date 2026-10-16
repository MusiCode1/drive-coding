import { afterEach, expect, it, vi } from "vitest"
import { hostState } from "./__contract__/http-recovery-fixture"
import { RemoteSessionView } from "./remote-session-view"
import type { RemoteTerminal } from "./remote-stream-events"

const seam = vi.hoisted(() => ({
  terminal: undefined as RemoteTerminal | undefined,
  close: vi.fn(),
}))
vi.mock("./sse-reader", () => ({
  SSEReader: class {
    get terminalFact() {
      return seam.terminal
    }
    close = seam.close
    async connect() {
      return {
        initial: {
          kind: "snapshot",
          source: terminal.source,
          state: hostState(12, { turnState: "responding" }),
        },
        events: new ReadableStream(),
      }
    }
  },
}))
afterEach(() => {
  seam.terminal = undefined
  vi.clearAllMocks()
})
const terminal: RemoteTerminal = {
  kind: "terminal",
  source: { hostIncarnation: "host-A", token: {} },
  reason: "taken-over",
}
it.each(["before-ready", "inside-ready", "inside-rejected-ready"])(
  "terminal fact %s closes canonical state before any sink binding",
  async (window) => {
    if (window === "before-ready") seam.terminal = terminal
    const ready = vi.fn(() => {
      seam.terminal = terminal
      if (window === "inside-rejected-ready") return false
    })
    const ended = vi.fn(),
      fetch = vi.fn()
    const view = new RemoteSessionView("agent", "http://fixture", {
      onReady: ready,
      onTerminal: ended,
      _fetch: fetch,
    })
    await view.connect()
    expect(view.state.turnState).toBe("idle")
    expect(view.state.status).toBe("disconnected")
    expect(ended).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledTimes(window === "before-ready" ? 0 : 1)
    expect(seam.close).toHaveBeenCalledTimes(1)
    await view.close()
    expect(fetch).not.toHaveBeenCalled()
  },
)
