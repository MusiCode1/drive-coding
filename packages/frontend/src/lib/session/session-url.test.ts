import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { describe, expect, it } from "vitest"
import { pickSessionHost, sessionPath, sessionPathWithTransport } from "./session-url.js"

const PI_SESSION_ID =
  "/home/user/.pi/agent/sessions/--home-user-Vendor-pi-acp-sdk--/2026-08-10T15-38-14-534Z_019fec53-1086-7f1e-81a1-471d53eda92b.jsonl"
const OPENCODE_SESSION_ID = "ses_0134ed30affegWXg0UG5SkikEG"

function makeAgent(overrides: Partial<AgentPublic> & Pick<AgentPublic, "id">): AgentPublic {
  return {
    cliKind: "claude",
    cwd: "/tmp",
    modelOverride: null,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("sessionPath", () => {
  it("builds canonical path with encodeURIComponent", () => {
    expect(sessionPath("claude", "abc-123")).toBe("/chat/claude/abc-123")
  })

  it("encodes sessionId containing slashes (pi file path)", () => {
    const path = sessionPath("pi", PI_SESSION_ID)
    expect(path).toBe(
      `/chat/pi/${encodeURIComponent(PI_SESSION_ID)}`,
    )
    expect(path).toContain("%2F")
  })

  it("round-trips pi sessionId through encode/decode", () => {
    const path = sessionPath("pi", PI_SESSION_ID)
    const encoded = path.split("/").slice(3).join("/")
    expect(decodeURIComponent(encoded)).toBe(PI_SESSION_ID)
  })

  it("encodes opencode sessionId", () => {
    expect(sessionPath("opencode", OPENCODE_SESSION_ID)).toBe(
      `/chat/opencode/${OPENCODE_SESSION_ID}`,
    )
  })
})

// ─── slice agent-patch-unify C4, ממצא 2: אותה מוסכמה כמו connect-agent.ts / handleReconnect ───
describe("sessionPathWithTransport", () => {
  it("http → מצרף ?sessionTransport=http לנתיב הקנוני", () => {
    expect(sessionPathWithTransport("claude", "abc-123", "http")).toBe(
      "/chat/claude/abc-123?sessionTransport=http",
    )
  })

  it("ws → נתיב עירום, בלי query (כמו היום)", () => {
    expect(sessionPathWithTransport("claude", "abc-123", "ws")).toBe("/chat/claude/abc-123")
  })

  it("sessionId=null + http → /chat?sessionTransport=http (fallback, כמו connect-agent.ts)", () => {
    expect(sessionPathWithTransport("claude", null, "http")).toBe("/chat?sessionTransport=http")
  })

  it("sessionId=null + ws → /chat בלבד", () => {
    expect(sessionPathWithTransport("claude", null, "ws")).toBe("/chat")
  })
})

describe("pickSessionHost", () => {
  it("returns exact when acpSessionId matches", () => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000001",
      cliKind: "claude",
      acpSessionId: "sess-a",
    })
    expect(pickSessionHost([agent], "claude", "sess-a")).toEqual({
      kind: "exact",
      agent,
    })
  })

  it("returns none when no candidates", () => {
    expect(pickSessionHost([], "claude", "sess-a")).toEqual({ kind: "none" })
  })

  it("excludes crashed and closed agents", () => {
    const agents = [
      makeAgent({
        id: "00000000-0000-4000-8000-000000000002",
        status: "crashed",
        acpSessionId: "sess-a",
      }),
      makeAgent({
        id: "00000000-0000-4000-8000-000000000003",
        status: "closed",
        acpSessionId: "sess-b",
      }),
    ]
    expect(pickSessionHost(agents, "claude", "sess-a")).toEqual({ kind: "none" })
  })

  it("excludes agents without acpSessionId", () => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000004",
      acpSessionId: undefined,
    })
    expect(pickSessionHost([agent], "claude", "sess-a")).toEqual({ kind: "none" })
  })

  it("filters by cliKind", () => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000005",
      cliKind: "cursor",
      acpSessionId: "sess-a",
    })
    expect(pickSessionHost([agent], "claude", "sess-a")).toEqual({ kind: "none" })
  })

  it("returns warm with unattached preferred over attached", () => {
    const attached = makeAgent({
      id: "00000000-0000-4000-8000-000000000006",
      acpSessionId: "other",
      attached: true,
      lastMessageAt: 1000,
    })
    const free = makeAgent({
      id: "00000000-0000-4000-8000-000000000007",
      acpSessionId: "other2",
      attached: false,
      lastMessageAt: 100,
    })
    expect(pickSessionHost([attached, free], "claude", "target")).toEqual({
      kind: "warm",
      agent: free,
    })
  })

  it("returns warm with highest lastMessageAt when same attachment", () => {
    const older = makeAgent({
      id: "00000000-0000-4000-8000-000000000008",
      acpSessionId: "old",
      lastMessageAt: 100,
    })
    const newer = makeAgent({
      id: "00000000-0000-4000-8000-000000000009",
      acpSessionId: "new",
      lastMessageAt: 500,
    })
    expect(pickSessionHost([older, newer], "claude", "target")).toEqual({
      kind: "warm",
      agent: newer,
    })
  })

  it("finds exact match for pi session path", () => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000010",
      cliKind: "pi",
      acpSessionId: PI_SESSION_ID,
    })
    expect(pickSessionHost([agent], "pi", PI_SESSION_ID)).toEqual({
      kind: "exact",
      agent,
    })
  })

  it("finds exact match for opencode session id", () => {
    const agent = makeAgent({
      id: "00000000-0000-4000-8000-000000000011",
      cliKind: "opencode",
      acpSessionId: OPENCODE_SESSION_ID,
    })
    expect(pickSessionHost([agent], "opencode", OPENCODE_SESSION_ID)).toEqual({
      kind: "exact",
      agent,
    })
  })
})
