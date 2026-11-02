// @vitest-environment jsdom
import type { AcpClient } from "@drive-coding/provider/client"
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let capturedExtNotification: ((method: string, params: Record<string, unknown>) => void) | null =
  null

const mockClient = {
  conn: {},
  capabilities: {},
  newSession: vi.fn().mockResolvedValue({ sessionId: "reactivity-caps" }),
  loadSession: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  prompt: vi.fn(),
  cancel: vi.fn(),
  close: vi.fn(),
  setSessionConfigOption: vi.fn(),
  setSessionMode: vi.fn(),
  setSessionModel: vi.fn(),
  extMethod: vi.fn().mockResolvedValue({ ok: true }),
} as unknown as AcpClient

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(
      (
        _transport: unknown,
        callbacks: {
          onExtNotification?: (m: string, p: Record<string, unknown>) => void
        },
      ) => {
        capturedExtNotification = callbacks.onExtNotification ?? null
        return Promise.resolve(mockClient)
      },
    ),
  }
})

vi.mock("@drive-coding/acp-wire/browser", () => ({
  WsAcpTransport: vi.fn(function mockWsTransport() {
    return {
      onClose: vi.fn(),
      waitForOpen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      closeAndWait: vi.fn().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-reactivity" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" })

import Harness from "./agent-session-capabilities-consumer.harness.svelte"

let target: HTMLDivElement | null = null
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
  capturedExtNotification = null
})

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

describe("AgentSession capabilities — consumer reactivity (bugs/104)", () => {
  it("config $state updates DOM; capabilities-only change does not update supports.usage display", async () => {
    target = document.createElement("div")
    document.body.appendChild(target)
    app = mount(Harness, { target })
    await tick()
    expect(target.querySelector("[data-testid=config-count]")?.textContent).toBe("0")
    expect(target.querySelector("[data-testid=supports-usage]")?.textContent).toBe("false")

    const session = (
      app as { getSession(): import("./agent-session.svelte").AgentSession }
    ).getSession()

    session.config.configOptions = [
      { id: "verbose", name: "Verbose", type: "boolean", currentValue: true, category: null },
    ]
    await tick()
    expect(target.querySelector("[data-testid=config-count]")?.textContent).toBe("1")

    await session.attach({ cwd: "/reactivity", cliKind: "claude" })
    capturedExtNotification?.("_drive/capabilities", {
      mcp: false,
      compact: false,
      commands: false,
      usage: true,
      configOptions: false,
      rename: false,
      thinkingTokens: false,
      image: false,
      systemPrompt: "unsupported",
    })
    await tick()
    expect(session.supports.usage).toBe(true)
    expect(target.querySelector("[data-testid=supports-usage]")?.textContent).toBe("false")
  })
})
