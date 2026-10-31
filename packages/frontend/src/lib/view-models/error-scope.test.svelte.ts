import { describe, expect, it } from "vitest"
import { ErrorScope } from "./error-scope.svelte"

describe("ErrorScope", () => {
  it("reset clears message and surfaced but not fromTurn", () => {
    const scope = new ErrorScope()
    scope.syncTurnError({ message: "x" })
    scope.surfaced = true
    scope.reset()
    expect(scope.message).toBeNull()
    expect(scope.surfaced).toBe(false)
    expect(scope.fromTurn).toContain("x")
  })

  it("syncTurnError clears only turn-sourced message on null snapshot", () => {
    const scope = new ErrorScope()
    scope.syncTurnError({ message: "boom" })
    scope.syncTurnError(null)
    expect(scope.message).toBeNull()
    scope.message = "external"
    scope.fromTurn = null
    scope.syncTurnError(null)
    expect(scope.message).toBe("external")
  })
})
