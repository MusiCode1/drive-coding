import { describe, expect, test } from "vitest"
import type { SessionInfo } from "$lib/adapters/sessions"
import { filterSessions, normalizeCwdForCompare } from "./filter-sessions"

function session(partial: Partial<SessionInfo> & Pick<SessionInfo, "sessionId">): SessionInfo {
  return {
    cwd: "/home/user/proj",
    title: "Default title",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  }
}

describe("normalizeCwdForCompare", () => {
  test("strips trailing slash", () => {
    expect(normalizeCwdForCompare("/home/user/proj/")).toBe("/home/user/proj")
  })

  test("keeps root slash", () => {
    expect(normalizeCwdForCompare("/")).toBe("/")
  })
})

describe("filterSessions", () => {
  test("empty list stays empty", () => {
    expect(filterSessions([], { query: "", currentCwd: null, currentCwdOnly: false })).toEqual([])
  })

  test("no filters returns all", () => {
    const sessions = [session({ sessionId: "a" }), session({ sessionId: "b" })]
    expect(
      filterSessions(sessions, { query: "", currentCwd: null, currentCwdOnly: false }),
    ).toEqual(sessions)
  })

  test("title substring is case-insensitive", () => {
    const sessions = [
      session({ sessionId: "a", title: "Fix Edge wrap" }),
      session({ sessionId: "b", title: "Other" }),
    ]
    expect(
      filterSessions(sessions, { query: "edge", currentCwd: null, currentCwdOnly: false }),
    ).toEqual([sessions[0]])
  })

  test("Hebrew title matches", () => {
    const sessions = [session({ sessionId: "a", title: "תיקון בועות" })]
    expect(
      filterSessions(sessions, { query: "בוע", currentCwd: null, currentCwdOnly: false }),
    ).toEqual(sessions)
  })

  test("empty title does not match search", () => {
    const sessions = [session({ sessionId: "a", title: "" })]
    expect(
      filterSessions(sessions, { query: "abc", currentCwd: null, currentCwdOnly: false }),
    ).toEqual([])
  })

  test("cwd filter is exact after trailing slash normalization", () => {
    const sessions = [
      session({ sessionId: "a", cwd: "/home/user/proj" }),
      session({ sessionId: "b", cwd: "/home/user/proj/sub" }),
      session({ sessionId: "c", cwd: "/home/user/other" }),
    ]
    expect(
      filterSessions(sessions, {
        query: "",
        currentCwd: "/home/user/proj/",
        currentCwdOnly: true,
      }),
    ).toEqual([sessions[0]])
  })

  test("cwd prefix does not match parent path", () => {
    const sessions = [session({ sessionId: "a", cwd: "/home/user/proj/sub" })]
    expect(
      filterSessions(sessions, {
        query: "",
        currentCwd: "/home/user/proj",
        currentCwdOnly: true,
      }),
    ).toEqual([])
  })

  test("cwd filter with no current cwd yields empty", () => {
    const sessions = [session({ sessionId: "a" })]
    expect(filterSessions(sessions, { query: "", currentCwd: null, currentCwdOnly: true })).toEqual(
      [],
    )
  })

  test("query and cwd filters combine with AND", () => {
    const sessions = [
      session({ sessionId: "a", title: "Alpha", cwd: "/home/user/proj" }),
      session({ sessionId: "b", title: "Alpha", cwd: "/home/user/other" }),
      session({ sessionId: "c", title: "Beta", cwd: "/home/user/proj" }),
    ]
    expect(
      filterSessions(sessions, {
        query: "alpha",
        currentCwd: "/home/user/proj",
        currentCwdOnly: true,
      }),
    ).toEqual([sessions[0]])
  })
})
