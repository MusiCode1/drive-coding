import { beforeEach, describe, expect, it, vi } from "vitest"

const beforeNavigateHandlers: Array<(nav: {
  from: { url: { pathname: string } } | null
  to: { url: { pathname: string } } | null | undefined
  willUnload: boolean
}) => void> = []

vi.mock("$app/navigation", () => ({
  beforeNavigate: (fn: (typeof beforeNavigateHandlers)[number]) => {
    beforeNavigateHandlers.push(fn)
    return () => {}
  },
}))

vi.mock("./session-scope", () => ({
  bindSessionScope: () => () => {},
}))

const routeChange = vi.fn()
vi.mock("./session-scope-nav", () => ({
  onSessionRouteChange: (...args: unknown[]) => routeChange(...args),
}))

import { bindSessionLifecycle } from "./session-lifecycle"

describe("session-lifecycle — willUnload HTTP guard", () => {
  beforeEach(() => {
    beforeNavigateHandlers.length = 0
    routeChange.mockClear()
  })

  it("skips onSessionRouteChange when willUnload and remote HTTP view", () => {
    bindSessionLifecycle({
      session: {
        isRemoteView: true,
        bindConnectionRelease: () => {},
        setSseReconnectedListener: () => {},
        notifySessionNavigatedAway: vi.fn(),
      } as never,
      speaker: { stop: () => {} },
      orderAlloc: { clear: () => {} },
      presencePoller: { onSseReconnected: () => {} },
    })
    const handler = beforeNavigateHandlers[0]!
    handler({
      from: { url: { pathname: "/chat/claude/s1" } },
      to: undefined,
      willUnload: true,
    })
    expect(routeChange).not.toHaveBeenCalled()
  })

  it("still routes SPA navigation away from session for remote HTTP", () => {
    bindSessionLifecycle({
      session: {
        isRemoteView: true,
        bindConnectionRelease: () => {},
        setSseReconnectedListener: () => {},
        notifySessionNavigatedAway: vi.fn(),
      } as never,
      speaker: { stop: () => {} },
      orderAlloc: { clear: () => {} },
      presencePoller: { onSseReconnected: () => {} },
    })
    beforeNavigateHandlers[0]!({
      from: { url: { pathname: "/chat/claude/s1" } },
      to: { url: { pathname: "/settings" } },
      willUnload: false,
    })
    expect(routeChange).toHaveBeenCalled()
  })
})
