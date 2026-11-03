/**
 * drive-message-view.api.test.ts — the api branch of the display model.
 *
 * The central assertion is a **negative** one: an api view must not carry a resolved
 * party. A party means an id, a display name and a link to that agent's session, and an
 * api caller has none of those — giving it the same shape is precisely how a declared
 * origin would end up rendered like a verified one.
 */

import { serializeDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { describe, expect, it } from "vitest"
import { type DriveMessageDeps, driveMessageView } from "./drive-message-view.js"

const AGENT_ID = "11111111-1111-4111-8111-111111111111"

function deps(overrides: Partial<DriveMessageDeps> = {}): DriveMessageDeps {
  return { agents: [], transport: "ws", ...overrides }
}

function knownAgent(): AgentPublic {
  return {
    id: AGENT_ID,
    cliKind: "cursor",
    cwd: "/tmp",
    modelOverride: null,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    acpSessionId: "sess-abc",
    roleLabel: "yetro",
  } as AgentPublic
}

describe("driveMessageView — source=api", () => {
  it("returns kind api with the caller as declared", () => {
    const raw = serializeDriveMessage({
      source: "api",
      caller: { kind: "tool", name: "n8n" },
      body: "b",
    })

    const view = driveMessageView(raw, deps())

    expect(view.kind).toBe("api")
    if (view.kind === "api") expect(view.message.caller).toEqual({ kind: "tool", name: "n8n" })
  })

  it("carries no party — no id, no displayName, no href", () => {
    const raw = serializeDriveMessage({ source: "api", caller: { name: "x" }, body: "b" })

    const view = driveMessageView(raw, deps({ agents: [knownAgent()] }))

    expect(view).not.toHaveProperty("sender")
    expect(view).not.toHaveProperty("subject")
  })

  it("a caller naming a real agent gets no link to it — the name is unverified text", () => {
    const raw = serializeDriveMessage({
      source: "api",
      caller: { kind: "agent", name: "yetro" },
      body: "b",
    })

    const view = driveMessageView(raw, deps({ agents: [knownAgent()] }))

    expect(view.kind).toBe("api")
    expect(JSON.stringify(view)).not.toContain("sess-abc")
  })

  it("a caller that declared nothing is still an api view", () => {
    const raw = serializeDriveMessage({ source: "api", body: "b" })

    const view = driveMessageView(raw, deps())

    expect(view.kind).toBe("api")
    if (view.kind === "api") expect(view.message.caller).toBeUndefined()
  })

  it("plain text is still plain — the api branch did not widen what counts as an envelope", () => {
    expect(driveMessageView("just a message", deps()).kind).toBe("plain")
  })

  it("an agent envelope still resolves its sender, unchanged", () => {
    const raw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID },
      body: "b",
    })

    const view = driveMessageView(raw, deps({ agents: [knownAgent()] }))

    expect(view.kind).toBe("agent")
    if (view.kind === "agent") expect(view.sender.displayName).toBe("yetro")
  })
})
