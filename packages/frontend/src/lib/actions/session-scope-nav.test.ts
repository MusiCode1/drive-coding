/**
 * session-scope-nav.test.ts — S2 session-scope-nav gates N4 (+ /chat→/ spy in C3).
 */

import { describe, expect, it, vi } from "vitest"
import { onSessionRouteChange } from "./session-scope-nav"

describe("session-scope-nav N4 — in-session navigation does not fire notify", () => {
  it("onSessionRouteChange /chat → /settings does not call notify", () => {
    const notify = vi.fn()
    onSessionRouteChange("/chat", "/settings", { notifySessionNavigatedAway: notify })
    expect(notify).not.toHaveBeenCalled()
  })

  it("onSessionRouteChange /settings → /chat does not call notify", () => {
    const notify = vi.fn()
    onSessionRouteChange("/settings", "/chat", { notifySessionNavigatedAway: notify })
    expect(notify).not.toHaveBeenCalled()
  })
})
