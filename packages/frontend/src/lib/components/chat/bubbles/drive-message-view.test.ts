/**
 * drive-message-view.test.ts — pure view helper (slice agent-message-envelope-ui C0).
 */

import {
  type DriveMessageAgent,
  type DriveMessageSystem,
  parseDriveMessage,
  serializeDriveMessage,
} from "@drive-coding/core/acp/drive-message-envelope"
import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { describe, expect, it } from "vitest"
import { type DriveMessageDeps, driveMessageView } from "./drive-message-view.js"

const AGENT_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "22222222-2222-4222-8222-222222222222"

function deps(overrides: Partial<DriveMessageDeps> = {}): DriveMessageDeps {
  return { agents: [], transport: "ws", ...overrides }
}

function agent(overrides: Partial<AgentPublic> & Pick<AgentPublic, "id">): AgentPublic {
  return {
    cliKind: "cursor",
    cwd: "/tmp",
    modelOverride: null,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    acpSessionId: "sess-abc",
    ...overrides,
  }
}

function wireAgent(msg: DriveMessageAgent): string {
  return serializeDriveMessage(msg)
}

function wireSystem(msg: DriveMessageSystem): string {
  return serializeDriveMessage(msg)
}

describe("driveMessageView — matrix (handoff appendix B)", () => {
  it("1 — agent with sender name", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "שולח" },
      body: "hi",
    })
    const view = driveMessageView(raw, deps())
    expect(view.kind).toBe("agent")
    if (view.kind === "agent") {
      expect(view.sender.displayName).toBe("שולח")
      expect(view.sender.fromId).toBe(false)
    }
  })

  it("2 — agent without name, no registry row", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID },
      body: "x",
    })
    const view = driveMessageView(raw, deps())
    expect(view.kind).toBe("agent")
    if (view.kind === "agent") {
      expect(view.sender.displayName).toBe("11111111…")
      expect(view.sender.fromId).toBe(true)
    }
  })

  it("3 — agent without name, registry roleLabel/title/null/whitespace", () => {
    const raw = wireAgent({ source: "agent", sender: { id: AGENT_ID }, body: "b" })
    const withRole = driveMessageView(
      raw,
      deps({ agents: [agent({ id: AGENT_ID, roleLabel: "  planner  " })] }),
    )
    if (withRole.kind !== "agent") throw new Error("expected agent")
    expect(withRole.sender.displayName).toBe("  planner  ")
    expect(withRole.sender.fromId).toBe(false)

    const withTitle = driveMessageView(
      raw,
      deps({ agents: [agent({ id: AGENT_ID, title: "My Title" })] }),
    )
    if (withTitle.kind !== "agent") throw new Error("expected agent")
    expect(withTitle.sender.displayName).toBe("My Title")

    const nullTitle = driveMessageView(
      raw,
      deps({ agents: [agent({ id: AGENT_ID, title: null, roleLabel: "   " })] }),
    )
    if (nullTitle.kind !== "agent") throw new Error("expected agent")
    expect(nullTitle.sender.displayName).toBe("11111111…")
    expect(nullTitle.sender.fromId).toBe(true)
  })

  it("4 — envelope name wins over live title", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "Snapshot" },
      body: "b",
    })
    const view = driveMessageView(
      raw,
      deps({ agents: [agent({ id: AGENT_ID, title: "Live changed" })] }),
    )
    if (view.kind !== "agent") throw new Error("expected agent")
    expect(view.sender.displayName).toBe("Snapshot")
  })

  it("5 — rich body preserved", () => {
    const body = "שלום 🎉 **bold**\n```\n<tag>&amp;\n```\nif (a & b) { x < y }"
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body,
    })
    const view = driveMessageView(raw, deps())
    if (view.kind !== "agent") throw new Error("expected agent")
    expect(view.message.body).toBe(body)
  })

  it("6 — context present as separate field", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      context: { kind: "project-charter", text: "CHARTER" },
      body: "BODY",
    })
    const view = driveMessageView(raw, deps())
    if (view.kind !== "agent") throw new Error("expected agent")
    expect(view.message.context?.text).toBe("CHARTER")
    expect(view.message.body).toBe("BODY")
  })

  it("7 — context absent", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "only",
    })
    const view = driveMessageView(raw, deps())
    if (view.kind !== "agent") throw new Error("expected agent")
    expect(view.message.context).toBeUndefined()
  })

  it("8 — system turn-ended with quote truncated=false", () => {
    const raw = wireSystem({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID, name: "Subj" },
      at: 1_800_000_000_000,
      lastAssistantText: { text: "quote", truncated: false },
    })
    const view = driveMessageView(raw, deps())
    expect(view.kind).toBe("system")
    if (view.kind === "system") {
      expect(view.message.lastAssistantText?.truncated).toBe(false)
      expect(view.message.lastAssistantText?.text).toBe("quote")
    }
  })

  it("9 — system turn-ended truncated=true", () => {
    const raw = wireSystem({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID },
      at: 1,
      lastAssistantText: { text: "q", truncated: true },
    })
    const view = driveMessageView(raw, deps())
    if (view.kind !== "system") throw new Error("expected system")
    expect(view.message.lastAssistantText?.truncated).toBe(true)
  })

  it("10 — system turn-ended without quote", () => {
    const raw = wireSystem({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID },
      at: 1,
    })
    const view = driveMessageView(raw, deps())
    if (view.kind !== "system") throw new Error("expected system")
    expect(view.message.lastAssistantText).toBeUndefined()
  })

  it("11 — system with lastTurnError", () => {
    const raw = wireSystem({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID },
      at: 1,
      lastTurnError: { message: "boom" },
    })
    const view = driveMessageView(raw, deps())
    if (view.kind !== "system") throw new Error("expected system")
    expect(view.message.lastTurnError?.message).toBe("boom")
  })

  it("12 — stall-suspected with and without silentMs", () => {
    const withSilent = wireSystem({
      source: "system",
      eventKind: "stall-suspected",
      subjectAgent: { id: AGENT_ID },
      at: 1,
      silentMs: 42_000,
    })
    const v1 = driveMessageView(withSilent, deps())
    if (v1.kind !== "system") throw new Error("expected system")
    expect(v1.message.silentMs).toBe(42_000)

    const without = wireSystem({
      source: "system",
      eventKind: "stall-suspected",
      subjectAgent: { id: AGENT_ID },
      at: 1,
    })
    const v2 = driveMessageView(without, deps())
    if (v2.kind !== "system") throw new Error("expected system")
    expect(v2.message.silentMs).toBeUndefined()
  })

  it("13 — version 2 → invalid unknown-version", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    }).replace('version="1"', 'version="2"')
    const view = driveMessageView(raw, deps())
    expect(view).toEqual({ kind: "invalid", reason: "unknown-version" })
  })

  it("14 — malformed variants", () => {
    const base = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    const dup = base.replace(
      "</sender>",
      '</sender>\n  <sender id="22222222-2222-4222-8222-222222222222"></sender>',
    )
    expect(driveMessageView(dup, deps()).kind).toBe("invalid")

    const sys = wireSystem({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID },
      at: 1,
    })
    const mixed = sys.replace("<event-kind>", "<body>x</body><event-kind>")
    expect(driveMessageView(mixed, deps()).kind).toBe("invalid")

    const cut = base.slice(0, -20)
    expect(driveMessageView(cut, deps()).kind).toBe("invalid")
  })

  it("15 — plain text, mention, envelope inside code fence", () => {
    expect(driveMessageView("hello world", deps()).kind).toBe("plain")
    expect(driveMessageView('see <drive-coding-msg version="1"> in prose', deps()).kind).toBe(
      "plain",
    )
    const inner = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    const fenced = `\`\`\`\n${inner}\n\`\`\``
    expect(driveMessageView(fenced, deps()).kind).toBe("plain")
  })

  it("16 — empty agents → no href", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    const view = driveMessageView(raw, deps())
    if (view.kind !== "agent") throw new Error("expected agent")
    expect(view.sender.href).toBeUndefined()
  })

  it("17 — closed/crashed or missing acpSessionId → no href", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    const closed = driveMessageView(
      raw,
      deps({ agents: [agent({ id: AGENT_ID, status: "closed" })] }),
    )
    if (closed.kind !== "agent") throw new Error("expected agent")
    expect(closed.sender.href).toBeUndefined()

    const noSess = driveMessageView(
      raw,
      deps({ agents: [agent({ id: AGENT_ID, acpSessionId: undefined })] }),
    )
    if (noSess.kind !== "agent") throw new Error("expected agent")
    expect(noSess.sender.href).toBeUndefined()
  })

  it("18 — valid row: href ws vs http transport", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    const row = agent({ id: AGENT_ID, cliKind: "claude", acpSessionId: "sess-xyz" })
    const ws = driveMessageView(raw, deps({ agents: [row], transport: "ws" }))
    if (ws.kind !== "agent") throw new Error("expected agent")
    expect(ws.sender.href).toBe("/chat/claude/sess-xyz")

    const http = driveMessageView(raw, deps({ agents: [row], transport: "http" }))
    if (http.kind !== "agent") throw new Error("expected agent")
    expect(http.sender.href).toBe("/chat/claude/sess-xyz?sessionTransport=http")
  })

  it("does not link warm host when id differs (exact match only)", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    const other = agent({ id: OTHER_ID, acpSessionId: "other-sess" })
    const view = driveMessageView(raw, deps({ agents: [other] }))
    if (view.kind !== "agent") throw new Error("expected agent")
    expect(view.sender.href).toBeUndefined()
  })

  it("uses parseDriveMessage only (sanity)", () => {
    const raw = wireAgent({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    expect(parseDriveMessage(raw).isOk()).toBe(true)
    expect(driveMessageView(raw, deps()).kind).toBe("agent")
  })
})
