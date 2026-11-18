/**
 * scope-write.test.ts — scope denial body shape (S0.1).
 */

import { describe, expect, it } from "vitest"
import { SCOPE_DENIED_BODY, scopeDeniedBody } from "./scope-write.js"

describe("scopeDeniedBody", () => {
  it("returns readable reason and hint for agents", () => {
    const body = scopeDeniedBody()
    expect(body.error).toBe("scope-denied")
    expect(body.reason.length).toBeGreaterThan(10)
    expect(body.hint.toLowerCase()).toMatch(/ask the user|human/)
    expect(body.hint).not.toMatch(/30 seconds/)
    expect(body.hint).toMatch(/automatic/i)
  })

  it("SCOPE_DENIED_BODY matches scopeDeniedBody()", () => {
    expect(SCOPE_DENIED_BODY).toEqual(scopeDeniedBody())
  })
})
