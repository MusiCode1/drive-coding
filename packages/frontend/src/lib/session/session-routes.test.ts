/**
 * session-routes.test.ts — S2 session-scope-nav gate N1.
 */

import { describe, expect, it } from "vitest"
import { isInSessionRoute } from "./session-routes"

describe("session-scope-nav N1 — isInSessionRoute route table", () => {
  it.each([
    ["/chat", true],
    ["/chat/", true],
    ["/chat/thread-1", true],
    ["/settings", true],
    ["/", false],
    ["/bt-test", false],
    ["/wake-word-test", false],
    ["", false],
  ])("isInSessionRoute(%j) → %j", (pathname, expected) => {
    expect(isInSessionRoute(pathname)).toBe(expected)
  })
})
