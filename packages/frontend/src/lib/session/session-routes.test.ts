/**
 * session-routes.test.ts — S2 session-scope-nav gate N1.
 */

import { describe, expect, it } from "vitest"
import { isInSessionRoute, isOutsideSessionRoute } from "./session-routes"

describe("session-scope-nav N1 — isInSessionRoute route table", () => {
  it.each([
    ["/chat", true],
    ["/chat/", true],
    ["/chat/thread-1", true],
    ["/settings", true],
    ["/usage", true],
    ["/", false],
    ["/bt-test", false],
    ["/wake-word-test", false],
    ["", false],
  ])("isInSessionRoute(%j) → %j", (pathname, expected) => {
    expect(isInSessionRoute(pathname)).toBe(expected)
  })
})

describe("session-scope-nav — isOutsideSessionRoute explicit leave targets", () => {
  it.each([
    ["", true],
    ["/", true],
    ["/bt-test", true],
    ["/wake-word-test", true],
    ["/playlist-nav-chrome-test", true],
    ["/chat", false],
    ["/settings", false],
    ["/some-future-route", false],
  ])("isOutsideSessionRoute(%j) → %j", (pathname, expected) => {
    expect(isOutsideSessionRoute(pathname)).toBe(expected)
  })
})
