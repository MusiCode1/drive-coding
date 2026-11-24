// @vitest-environment jsdom

import {
  closeCodeForStatus,
  createInitialSessionState,
  encodeWsFrame,
  serializeFrame,
  snapshotFrame,
} from "@drive-coding/core/session"
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deleteAgent } from "$lib/adapters/agents-api"
import AuthGuidance from "$lib/components/AuthGuidance.svelte"
import { fakeSessionSockets } from "$lib/session/__contract__/fake-session-socket"
import type { SessionTransport } from "$lib/session/session-transport"
import { MockSessionView } from "./__fixtures__/mock-session-view.svelte"
import { AgentSession } from "./agent-session.svelte"

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "new-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  releaseConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("$lib/context", () => ({
  getI18n: () => ({ t: (key: string) => key }),
  getCliAvailability: () => ({ details: {} }),
}))

const methods = [
  { id: "login", name: "Sign in", description: "Open the provider login" },
  { id: "terminal", name: "Terminal login", type: "terminal", description: "Run provider login" },
  {
    id: "env",
    name: "API token",
    type: "env_var",
    vars: [{ name: "PROVIDER_TOKEN" }],
    link: "https://example.com/login",
  },
]
const authRequired = {
  kind: "auth_required",
  error: "Provider needs authentication",
  authMethods: methods,
}

async function attachWithError(
  transport: SessionTransport,
  raw: string | undefined,
  { live = false, status = 401 }: { live?: boolean; status?: number } = {},
) {
  const sockets = fakeSessionSockets()
  const fetch = vi.fn(
    async () => new Response(raw, { status, headers: { "content-type": "application/json" } }),
  )
  vi.stubGlobal("fetch", fetch)
  vi.stubGlobal("WebSocket", sockets.WebSocket)
  const session = new AgentSession()
  const input = { cwd: "/project", cliKind: "codex", transport }
  const attaching = live
    ? session.attachRemoteToLiveAgent({ ...input, agentId: "live-agent" })
    : session.attachRemote(input)
  if (transport === "ws") {
    await vi.waitFor(() => expect(sockets.instances).toHaveLength(1))
    const socket = sockets.latest()
    socket.connect()
    if (raw !== undefined) socket.receive(encodeWsFrame({ event: "error", data: raw }))
    socket.close(closeCodeForStatus(status))
  }
  await attaching
  expect(session.status).toBe("error")
  expect(sockets.instances.length + fetch.mock.calls.length).toBe(1)
  return session
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe.each(["http", "ws"] as const)("%s authentication guidance", (transport) => {
  it.each([false, true])("renders all advertised methods (live agent: %s)", async (live) => {
    const session = await attachWithError(transport, JSON.stringify(authRequired), { live })
    expect(session.error).toBe(authRequired.error)
    expect(session.authMethods).toEqual(methods)
    if (live) expect(deleteAgent).not.toHaveBeenCalled()
    else expect(deleteAgent).toHaveBeenCalledWith("new-agent")

    const target = document.createElement("div")
    const component = mount(AuthGuidance, {
      target,
      props: { cliKind: session.cliKind, authMethods: session.authMethods },
    })
    try {
      flushSync()
      const panel = target.querySelector('[role="region"]')
      expect(panel?.querySelectorAll("li")).toHaveLength(3)
      expect(panel?.textContent).toContain("Open the provider login")
      expect(panel?.textContent).toContain("Run provider login")
      expect(panel?.textContent).toContain("PROVIDER_TOKEN")
      expect(panel?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/login")
    } finally {
      await unmount(component)
    }
  })

  it("clears guidance when a subsequent attach succeeds", async () => {
    const session = await attachWithError(transport, JSON.stringify(authRequired))
    expect(session.authMethods).toEqual(methods)
    const frame = snapshotFrame(createInitialSessionState({ sessionId: "authenticated" }))
    const sockets = fakeSessionSockets()
    vi.stubGlobal("WebSocket", sockets.WebSocket)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(serializeFrame(frame)))
              init.signal?.addEventListener("abort", () => controller.close(), { once: true })
            },
          }),
        )
      }),
    )
    const attaching = session.attachRemoteToLiveAgent({
      agentId: "authenticated-agent",
      cwd: "/project",
      cliKind: "claude",
      transport,
    })
    if (transport === "ws") {
      const socket = sockets.latest()
      socket.connect()
      socket.receive(encodeWsFrame(frame))
    }
    try {
      await attaching
      expect(session.status).toBe("connected")
      expect(session.error).toBeNull()
      expect(session.authMethods).toEqual([])
    } finally {
      session.detach()
    }
  })

  it.each([
    ["missing body", undefined, 401],
    ["malformed JSON", "{", 401],
    ["unstructured body", "null", 401],
    ["unrelated 401", JSON.stringify({ authMethods: methods }), 401],
    ["missing methods", JSON.stringify({ kind: "auth_required" }), 401],
    ["non-array methods", JSON.stringify({ ...authRequired, authMethods: {} }), 401],
    ["empty methods", JSON.stringify({ ...authRequired, authMethods: [] }), 401],
    ["invalid method entry", JSON.stringify({ ...authRequired, authMethods: [{ id: 1 }] }), 401],
    [
      "invalid env method",
      JSON.stringify({ ...authRequired, authMethods: [{ ...methods[2], vars: [{}] }] }),
      401,
    ],
    [
      "duplicate method IDs",
      JSON.stringify({ ...authRequired, authMethods: [methods[0], methods[0]] }),
      401,
    ],
    ["different status", JSON.stringify(authRequired), 403],
  ] as const)("preserves the error and omits guidance for %s", async (_, raw, status) => {
    const session = await attachWithError(transport, raw, { status })
    expect(session.error).toBeTruthy()
    expect(session.authMethods).toEqual([])
  })
})

it("has no authentication guidance before connecting", () => {
  expect(new AgentSession().authMethods).toEqual([])
})

it("surfaces the provider details when the prompt rejects", async () => {
  const view = new MockSessionView()
  view.connect("test-session")
  view.promptMock.mockRejectedValueOnce({
    code: -32603,
    message: "Internal error",
    data: { details: "Authentication required" },
  })
  const session = new AgentSession({ view })
  session._setStatusForTest("connected")
  session._setSessionContextForTest({
    sessionId: "test-session",
    cwd: "/project",
    cliKind: "claude",
  })

  await session.sendPrompt("hello")

  expect(session.error).toContain("Authentication required")
  expect(session.authMethods).toEqual([])
})
