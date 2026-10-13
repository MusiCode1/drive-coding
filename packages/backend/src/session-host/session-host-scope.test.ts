/**
 * session-host-scope.test.ts — scope escalation timer (slice scope-escalation-timeout C2).
 */

import { createInitialSessionState, type Patch } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  attachScopePermission,
  createRequestScopePermission,
} from "./session-host-scope.js"
import { createPendingRequests } from "./pending-requests.js"
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk"

function makeScopeDeps(scopeTimeoutMs?: number | null) {
  let state = createInitialSessionState({ sessionId: "s-scope" })
  const patches: Patch[] = []
  const permPending = createPendingRequests<RequestPermissionResponse>({ timeoutMs: null })
  let nextId = 1
  const base = {
    isDisposed: () => false,
    getState: () => state,
    setState: (s: typeof state) => {
      state = s
    },
    emitPatches: (p: Patch[]) => {
      patches.push(...p)
    },
    nextRequestId: () => nextId++,
    permPending,
    scopeTimeoutMs,
  }
  return { base, getPatches: () => patches, permPending }
}

describe("scope escalation timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("expiry resolves requestScopePermission to deny", async () => {
    const { base } = makeScopeDeps(5_000)
    const request = createRequestScopePermission({
      ...base,
      markScopeRequest: () => {},
    })
    const promise = request({
      callerId: "a",
      targetId: "b",
      verb: "delete",
    })
    vi.advanceTimersByTime(5_000)
    await expect(promise).resolves.toBe("deny")
  })

  it("expiry clears pending.permission and emits patch", async () => {
    const { base, getPatches } = makeScopeDeps(5_000)
    const request = createRequestScopePermission({
      ...base,
      markScopeRequest: () => {},
    })
    const promise = request({
      callerId: "a",
      targetId: "b",
      verb: "delete",
    })
    expect(base.getState().pending.permission).not.toBeNull()
    vi.advanceTimersByTime(5_000)
    await promise
    expect(base.getState().pending.permission).toBeNull()
    expect(getPatches().some((p) => p.op === "update-session")).toBe(true)
  })

  it("user response before expiry clears timer — later advance is no-op", async () => {
    const { base, permPending } = makeScopeDeps(5_000)
    const request = createRequestScopePermission({
      ...base,
      markScopeRequest: () => {},
    })
    const promise = request({
      callerId: "a",
      targetId: "b",
      verb: "delete",
    })
    const requestId = base.getState().pending.permission!.requestId
    permPending.respond(requestId, {
      outcome: { outcome: "selected", optionId: "scope-allow-once" },
    })
    await expect(promise).resolves.toBe("allow")
    const pendingAfter = base.getState().pending.permission
    vi.advanceTimersByTime(10 * 60_000)
    expect(base.getState().pending.permission).toBe(pendingAfter)
  })

  it("attachScopePermission with scopeTimeoutMs null keeps request pending", async () => {
    const { base } = makeScopeDeps(null)
    const { requestScopePermission } = attachScopePermission(base)
    const promise = requestScopePermission({
      callerId: "a",
      targetId: "b",
      verb: "delete",
    })
    vi.advanceTimersByTime(10 * 60_000)
    let settled = false
    promise
      .then(() => {
        settled = true
      })
      .catch(() => {
        settled = true
      })
    await Promise.resolve()
    expect(settled).toBe(false)
    base.permPending.respond(base.getState().pending.permission!.requestId, {
      outcome: { outcome: "cancelled" },
    })
    await promise
  })
})
