/**
 * agent-recovery.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────────

const gotoMock = vi.fn(async (_url: string, _opts?: { replaceState?: boolean }) => {})
vi.mock("$app/navigation", () => ({
  goto: (url: string, opts?: { replaceState?: boolean }) => gotoMock(url, opts),
}))

const createAgentMock = vi.fn(
  async (_input: unknown): Promise<{ agentId: string; cwd: string; cliKind: string }> => ({
    agentId: "new-agent-id",
    cwd: "/x",
    cliKind: "opencode",
  }),
)
vi.mock("$lib/api/agents", () => ({
  createAgent: (input: unknown) => createAgentMock(input),
}))

const listProjectsMock = vi.fn(async () => [] as unknown[])
vi.mock("$lib/api/sessions", () => ({
  listProjects: () => listProjectsMock(),
}))

// agent-storage uses real localStorage (jsdom)
import {
  clearAgentMetadata,
  saveAgentMetadata,
} from "./agent-storage"
import { notifications } from "./notifications-store.svelte"
import { recoverAgent } from "./agent-recovery"

beforeEach(() => {
  localStorage.clear()
  notifications.clear()
  gotoMock.mockClear()
  createAgentMock.mockClear()
  listProjectsMock.mockReset()
  listProjectsMock.mockResolvedValue([])
  // Default: createAgent succeeds
  createAgentMock.mockResolvedValue({
    agentId: "new-agent-id",
    cwd: "/x",
    cliKind: "opencode",
  })
})

describe("recoverAgent — cache miss", () => {
  it("pushes notification and navigates to dashboard", async () => {
    await recoverAgent("missing-id")
    expect(createAgentMock).not.toHaveBeenCalled()
    expect(notifications.list).toHaveLength(1)
    expect(notifications.list[0]?.text).toMatch(/הסוכן הקודם/)
    expect(gotoMock).toHaveBeenCalledWith("/", { replaceState: true })
  })
})

describe("recoverAgent — cache hit, happy path", () => {
  beforeEach(() => {
    saveAgentMetadata({
      agentId: "old-id",
      cwd: "/home/user/myproj",
      cliKind: "opencode",
      acpSessionId: "sess-from-cache",
      modelOverride: null,
    })
  })

  it("creates a new agent with cached cwd + cliKind + sessionId, navigates to /agent/<new>", async () => {
    await recoverAgent("old-id")
    expect(createAgentMock).toHaveBeenCalledTimes(1)
    const arg = createAgentMock.mock.calls[0]?.[0] as {
      cwd: string
      cliKind: string
      existingSessionId?: string
      modelOverride?: string | null
    }
    expect(arg.cwd).toBe("/home/user/myproj")
    expect(arg.cliKind).toBe("opencode")
    expect(arg.existingSessionId).toBe("sess-from-cache")
    expect(arg.modelOverride).toBeNull()
    expect(gotoMock).toHaveBeenCalledWith("/agent/new-agent-id", { replaceState: true })
  })

  it("clears the old cache entry after a successful recovery", async () => {
    await recoverAgent("old-id")
    expect(localStorage.getItem("voice-acp:agent:old-id")).toBeNull()
  })

  it("does not push any notification on success", async () => {
    await recoverAgent("old-id")
    expect(notifications.list).toHaveLength(0)
  })
})

describe("recoverAgent — prefers BE projects-registry over cache for sessionId", () => {
  beforeEach(() => {
    saveAgentMetadata({
      agentId: "old-id",
      cwd: "/p",
      cliKind: "opencode",
      acpSessionId: "stale-from-cache",
      modelOverride: null,
    })
  })

  it("uses projects.lastSessionId when project matches the cached cwd", async () => {
    listProjectsMock.mockResolvedValue([
      { cwd: "/p", kind: "opencode", lastSessionId: "fresh-from-be", lastSeen: "now" },
    ])
    await recoverAgent("old-id")
    const arg = createAgentMock.mock.calls[0]?.[0] as { existingSessionId?: string }
    expect(arg.existingSessionId).toBe("fresh-from-be")
  })

  it("falls back to cached acpSessionId if project has no lastSessionId", async () => {
    listProjectsMock.mockResolvedValue([
      { cwd: "/p", kind: "opencode", lastSeen: "now" },
    ])
    await recoverAgent("old-id")
    const arg = createAgentMock.mock.calls[0]?.[0] as { existingSessionId?: string }
    expect(arg.existingSessionId).toBe("stale-from-cache")
  })

  it("falls back to cached cliKind if listProjects throws", async () => {
    listProjectsMock.mockRejectedValue(new Error("network down"))
    await recoverAgent("old-id")
    const arg = createAgentMock.mock.calls[0]?.[0] as {
      cliKind: string
      existingSessionId?: string
    }
    expect(arg.cliKind).toBe("opencode")
    expect(arg.existingSessionId).toBe("stale-from-cache")
  })
})

describe("recoverAgent — createAgent fails (cwd deleted, etc.)", () => {
  beforeEach(() => {
    saveAgentMetadata({
      agentId: "old-id",
      cwd: "/gone",
      cliKind: "opencode",
      acpSessionId: null,
      modelOverride: null,
    })
  })

  it("pushes an error notification with the failure detail", async () => {
    createAgentMock.mockRejectedValue(new Error("spawn failed: ENOENT"))
    await recoverAgent("old-id")
    expect(notifications.list).toHaveLength(1)
    const n = notifications.list[0]!
    expect(n.kind).toBe("error")
    expect(n.text).toMatch(/שחזור הסוכן נכשל/)
    expect(n.text).toMatch(/ENOENT/)
  })

  it("clears the old cache so we don't keep retrying", async () => {
    createAgentMock.mockRejectedValue(new Error("nope"))
    await recoverAgent("old-id")
    expect(localStorage.getItem("voice-acp:agent:old-id")).toBeNull()
  })

  it("navigates to dashboard", async () => {
    createAgentMock.mockRejectedValue(new Error("nope"))
    await recoverAgent("old-id")
    expect(gotoMock).toHaveBeenLastCalledWith("/", { replaceState: true })
  })
})
