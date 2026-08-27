/**
 * live-dispatch.test.ts — TDD for prompt dispatch gate (mirrors sendPrompt guards).
 *
 * Slice: live-secretary, Commit 0.
 */

import { describe, expect, it } from "vitest"
import { canDispatchPrompt } from "./live-dispatch"

const ready = {
  status: "connected",
  hasClient: true,
  hasSessionId: true,
  isRemoteView: false,
  text: "fix the bug",
}

describe("canDispatchPrompt", () => {
  it("ok when connected with local session and non-empty text", () => {
    expect(canDispatchPrompt(ready)).toEqual({ ok: true })
  })

  it("ok when connected in remote view without local client", () => {
    expect(
      canDispatchPrompt({
        ...ready,
        hasClient: false,
        hasSessionId: false,
        isRemoteView: true,
      }),
    ).toEqual({ ok: true })
  })

  it("not-connected when status is not connected", () => {
    expect(canDispatchPrompt({ ...ready, status: "idle" })).toEqual({
      ok: false,
      reason: "not-connected",
    })
  })

  it("no-session when local path lacks client", () => {
    expect(canDispatchPrompt({ ...ready, hasClient: false })).toEqual({
      ok: false,
      reason: "no-session",
    })
  })

  it("no-session when local path lacks sessionId", () => {
    expect(canDispatchPrompt({ ...ready, hasSessionId: false })).toEqual({
      ok: false,
      reason: "no-session",
    })
  })

  it("empty-text when text is blank", () => {
    expect(canDispatchPrompt({ ...ready, text: "   " })).toEqual({
      ok: false,
      reason: "empty-text",
    })
  })
})
