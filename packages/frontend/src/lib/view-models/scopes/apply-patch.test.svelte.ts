/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest"
import { SessionScope } from "../session-scoped-state.svelte"
import { SessionsCacheScope } from "../sessions-cache-scope.svelte"

describe("scope patch ownership", () => {
  it("applies metadata through SessionScope", () => {
    const scope = new SessionScope("s1")
    scope.applyPatch({ kind: "commands", commands: [{ name: "test", description: "test" }] })
    scope.applyPatch({ kind: "title", title: "hello" })
    expect(scope.availableCommands.map((command) => command.name)).toEqual(["test"])
    expect(scope.title).toBe("hello")
  })

  it("applies list, removal and reset through SessionsCacheScope", () => {
    const scope = new SessionsCacheScope()
    scope.applyPatch({
      kind: "list",
      sessions: [{ sessionId: "s1", cwd: "/", title: "", updatedAt: "" }],
    })
    expect(scope.sessions.map((session) => session.sessionId)).toEqual(["s1"])
    scope.applyPatch({ kind: "remove", sessionId: "s1" })
    expect(scope.sessions).toEqual([])
    scope.applyPatch({
      kind: "list",
      sessions: [{ sessionId: "s2", cwd: "/", title: "", updatedAt: "" }],
    })
    scope.applyPatch({ kind: "reset" })
    expect(scope.sessions).toEqual([])
  })
})
