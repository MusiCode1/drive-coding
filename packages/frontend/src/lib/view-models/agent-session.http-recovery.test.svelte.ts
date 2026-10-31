import type { SessionState } from "@drive-coding/core/session"
import { afterEach, expect, it, vi } from "vitest"
import {
  deferred,
  HttpStream,
  hostState,
  textUpdate,
} from "$lib/session/__contract__/http-recovery-fixture"
import { RemoteSessionView } from "$lib/session/remote-session-view"
import { AgentSession } from "./agent-session.svelte"

const sessions: AgentSession[] = []
const streams: HttpStream[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.detach()
  for (const stream of streams.splice(0)) stream.end()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const pending = (kind: "permission" | "elicitation"): SessionState["pending"] => ({
  permission:
    kind === "permission"
      ? {
          requestId: 7,
          params: {
            options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
            toolCall: { toolCallId: "tool", title: "Tool", status: "pending" },
          } as never,
        }
      : null,
  elicitation:
    kind === "elicitation"
      ? {
          requestId: 7,
          params: {
            message: "Input",
            requestedSchema: { type: "object", properties: {} },
          } as never,
        }
      : null,
})
const wait = (check: () => void) => vi.waitFor(check, { timeout: 3000, interval: 10 })
async function harness(extra: Partial<SessionState> = {}, observed?: (update: unknown) => void) {
  const first = new HttpStream(hostState(43, extra))
  streams.push(first)
  const next = new HttpStream(hostState(13, extra), "host-B")
  streams.push(next)
  const writes: { url: string; body: unknown }[] = []
  let eventCalls = 0
  let rpc: (() => Promise<Response>) | undefined
  let reply: (() => Promise<Response>) | undefined
  let terminal = false
  vi.stubGlobal("location", {
    origin: "http://fixture",
    protocol: "http:",
    host: "fixture",
    search: "",
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/events")) {
        eventCalls++
        if (eventCalls === 1) return first.response
        return terminal ? new Response(null, { status: 404 }) : next.response
      }
      writes.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.endsWith("/rpc") && rpc) return rpc()
      if (url.endsWith("/reply") && reply) return reply()
      return Response.json({ ok: true, sessionId: "same-sid", sessions: [] })
    }),
  )
  const session = new AgentSession({ _onUpdateObserved: observed })
  sessions.push(session)
  await session.attachRemoteToLiveAgent({ agentId: "agent", cwd: "/tmp", cliKind: "claude" })
  expect(session.status).toBe("connected")
  return {
    session,
    first,
    next,
    writes,
    rpc: (fn: () => Promise<Response>) => {
      rpc = fn
    },
    reply: (fn: () => Promise<Response>) => {
      reply = fn
    },
    gone: () => {
      terminal = true
      first.end()
    },
    recreated: async () => {
      first.end()
      await wait(() => expect(session.sessionState.version).toBe(13))
    },
  }
}
it("deferred sameSID load loses ownership at host recreation, clears loading and permits a new load", async () => {
  const h = await harness()
  const completion = deferred<Response>()
  h.rpc(() => completion.promise)
  const old = h.session.switchSession({ sessionId: "same-sid", cwd: "/tmp", cliKind: "claude" })
  await wait(() => expect(h.session.isLoadingHistory).toBe(true))
  await h.recreated()
  expect(h.session.isLoadingHistory).toBe(false)
  completion.resolve(Response.json({ sessionId: "obsolete-sid", configOptions: [] }))
  await old
  expect(h.session.sessionId).toBe("same-sid")
  expect(h.session.error).toBeNull()
  h.rpc(async () => Response.json({ sessionId: "same-sid" }))
  const before = h.writes.length
  await h.session.switchSession({ sessionId: "same-sid", cwd: "/tmp", cliKind: "claude" })
  expect(h.writes.length).toBeGreaterThan(before)
  expect(h.session.isLoadingHistory).toBe(false)
})
it.each(["permission", "elicitation"] as const)(
  "old %s same-ID callback cannot reply in recreated host; new reply works",
  async (kind) => {
    const h = await harness({ pending: pending(kind) })
    const old = kind === "permission" ? h.session.pendingPermission : h.session.pendingElicitation
    expect(old).not.toBeNull()
    await h.recreated()
    const fresh = kind === "permission" ? h.session.pendingPermission : h.session.pendingElicitation
    expect(fresh).not.toBe(old)
    const before = h.writes.filter((r) => r.url.endsWith("/reply")).length
    if (kind === "permission")
      h.session.pendingPermission &&
        (old as typeof h.session.pendingPermission)?.resolve({ outcome: { outcome: "cancelled" } })
    else (old as typeof h.session.pendingElicitation)?.resolve({ action: "cancel" })
    expect(h.writes.filter((r) => r.url.endsWith("/reply"))).toHaveLength(before)
    if (kind === "permission") h.session.resolvePermission("allow")
    else h.session.resolveElicitation({ value: "new" })
    await wait(() =>
      expect(h.writes.filter((r) => r.url.endsWith("/reply"))).toHaveLength(before + 1),
    )
  },
)
it.each(["permission", "elicitation"] as const)(
  "old %s rejection cannot corrupt new same-ID pending",
  async (kind) => {
    const h = await harness({ pending: pending(kind) })
    const completion = deferred<Response>()
    h.reply(() => completion.promise)
    if (kind === "permission") h.session.resolvePermission("allow")
    else h.session.resolveElicitation({ value: "old" })
    await h.recreated()
    completion.reject(new Error("old reply failed"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.session.error).toBeNull()
    expect(
      kind === "permission"
        ? h.session.pendingPermission?.requestId
        : h.session.pendingElicitation?.requestId,
    ).toBe(7)
    h.reply(async () => Response.json({ ok: true }))
    if (kind === "permission") h.session.resolvePermission("allow")
    else h.session.resolveElicitation({ value: "new" })
    expect(h.writes.filter((r) => r.url.endsWith("/reply"))).toHaveLength(2)
  },
)
it("same-host transcript replacement does not fence a valid pending callback", async () => {
  const h = await harness({ pending: pending("permission") })
  const callback = h.session.pendingPermission!
  const port = h.session.speakerTranscript()
  const target = port.processingTarget
  h.first.update(44, {
    sessionUpdate: "_drive/reset",
    messages: [],
    nextMessageSeq: 0,
    nextSegmentSeq: 0,
  })
  await wait(() => expect(port.processingTarget).not.toBe(target))
  callback.resolve({ outcome: { outcome: "selected", optionId: "allow" } })
  expect(h.writes.filter((r) => r.url.endsWith("/reply"))).toHaveLength(1)
})
it("host recreation renews processing/annotation/history after attach window and accepts live content", async () => {
  const h = await harness({
    messages: [
      {
        id: "m_0",
        role: "assistant",
        messageId: "history",
        segments: [{ id: "s_0", text: "history" }],
      },
    ],
    nextMessageSeq: 1,
    nextSegmentSeq: 1,
  })
  const port = h.session.speakerTranscript()
  const processing = port.processingTarget,
    annotation = port.captureTarget(),
    epoch = port.historyEpoch
  await h.recreated()
  expect(port.processingTarget).not.toBe(processing)
  expect(port.isCurrent(annotation)).toBe(false)
  expect(port.historyEpoch).toBeGreaterThan(epoch)
  expect(port.historyMark.processingTarget).toBe(port.processingTarget)
  expect([...port.historyMark.mark.segmentCounts.values()]).toEqual([1])
  h.next.update(17, textUpdate(" live"))
  await wait(() => expect(port.recentAssistantMessages(1).join("")).toContain("live"))
})
it("observer failure then terminal ends VM turn via lifecycle, keeps transcript and never revives sink", async () => {
  let fail = false,
    seen = 0
  const h = await harness(
    {
      turnState: "responding",
      pending: pending("permission"),
      messages: [
        {
          id: "m_0",
          role: "assistant",
          messageId: "p",
          segments: [{ id: "s_0", text: "retained" }],
        },
      ],
    },
    () => {
      seen++
      if (fail) throw new Error("observer failed")
    },
  )
  expect(h.session.turnState).toBe("responding")
  fail = true
  h.first.update(44, textUpdate("not delivered"))
  await wait(() => expect(seen).toBe(1))
  h.gone()
  await wait(() => expect(h.session.status).toBe("error"))
  expect(h.session.turnState).toBe("idle")
  expect(h.session.pendingPermission).toBeNull()
  expect(h.session.isLoadingHistory).toBe(false)
  expect(seen).toBe(1)
  expect(h.session.bubbles).toHaveLength(1)
  expect(
    h.writes.filter(
      (r) =>
        /reply|connection/.test(r.url) ||
        (r.body as { method?: string })?.method === "session/cancel",
    ),
  ).toEqual([])
})

it("host recreation invalidates RPC ownership even after the UI observer has stopped", async () => {
  let observed = 0
  let remote!: RemoteSessionView
  const connect = RemoteSessionView.prototype.connect
  vi.spyOn(RemoteSessionView.prototype, "connect").mockImplementation(function (
    this: RemoteSessionView,
  ) {
    remote = this
    return connect.call(this)
  })
  const h = await harness({ pending: pending("permission") }, () => {
    observed++
    throw new Error("controlled observer failure")
  })
  const oldPending = h.session.pendingPermission
  if (!oldPending) throw new Error("Missing initial permission")
  const completion = deferred<Response>()
  h.rpc(() => completion.promise)
  const old = h.session.switchSession({ sessionId: "same-sid", cwd: "/tmp", cliKind: "claude" })
  await wait(() => expect(h.session.isLoadingHistory).toBe(true))
  h.first.update(44, textUpdate("observer boundary"))
  await wait(() => expect(observed).toBe(1))
  h.first.end()
  await wait(() => expect(remote.hostIncarnation).toBe("host-B"))
  expect(remote.state.version).toBe(13)
  const afterHost = { loading: h.session.isLoadingHistory, error: h.session.error }
  const beforeReply = h.writes.filter((r) => r.url.endsWith("/reply")).length
  oldPending.resolve({ outcome: { outcome: "selected", optionId: "allow" } })
  expect(h.writes.filter((r) => r.url.endsWith("/reply"))).toHaveLength(beforeReply)
  h.rpc(async () => Response.json({ sessionId: "same-sid" }))
  const nextResult = await h.session
    .switchSession({ sessionId: "same-sid", cwd: "/tmp", cliKind: "claude" })
    .then(
      () => "accepted",
      (e) => String(e),
    )
  completion.resolve(Response.json({ sessionId: "obsolete-sid" }))
  await old
  expect.soft(afterHost.loading).toBe(false)
  expect.soft(nextResult).toBe("accepted")
  expect.soft(h.session.error).toBeNull()
  expect(h.session.sessionId).toBe("same-sid")
  expect(h.session.isLoadingHistory).toBe(false)
  expect(h.session.pendingPermission).toBeNull()
  expect(observed).toBe(1)
})
