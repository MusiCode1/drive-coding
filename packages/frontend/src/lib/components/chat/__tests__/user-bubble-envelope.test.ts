// @vitest-environment jsdom
/**
 * user-bubble-envelope.test.ts — DOM harness for envelope rendering (slice agent-message-envelope-ui C1).
 */

import { serializeDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { UserBubble } from "$lib/types/bubble"
import EnvelopeHarness, {
  type EnvelopeHarnessState,
  envelopeHarnessControls,
} from "./user-bubble-envelope-harness.svelte"

vi.mock("$env/dynamic/public", () => ({
  env: { PUBLIC_SESSION_TRANSPORT: undefined },
}))

const AGENT_ID = "11111111-1111-4111-8111-111111111111"

function makeAgent(overrides: Partial<AgentPublic> & Pick<AgentPublic, "id">): AgentPublic {
  return {
    cliKind: "cursor",
    cwd: "/tmp",
    modelOverride: null,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    acpSessionId: "sess-live",
    ...overrides,
  }
}

function userBubble(segments: UserBubble["segments"], extra: Partial<UserBubble> = {}): UserBubble {
  return {
    id: "b1",
    kind: "user",
    messageId: "m1",
    createdAt: Date.now(),
    segments,
    ...extra,
  }
}

let target: HTMLDivElement | null = null
let app: object | null = null
let harnessState: EnvelopeHarnessState

function mountEnvelope(initial: EnvelopeHarnessState): HTMLElement {
  harnessState = initial
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(EnvelopeHarness, { target, props: { harnessState } })
  flushSync()
  return target
}

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

describe("UserBubble envelope DOM", () => {
  it("renders agent label, name, and body", () => {
    const body = "Hello envelope body"
    const raw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Agent Name" },
      body,
    })
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    const text = root.textContent ?? ""
    expect(text).toContain("driveMessage.agent.label")
    expect(text).toContain("Agent Name")
    expect(text).toContain(body)
  })

  it("shows link when agents row is valid, none when empty", () => {
    const raw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Linked" },
      body: "x",
    })
    const withLink = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [makeAgent({ id: AGENT_ID, cliKind: "claude", acpSessionId: "abc-sess" })],
    })
    expect(withLink.querySelector('a[href="/chat/claude/abc-sess"]')).not.toBeNull()

    if (app !== null) unmount(app)
    withLink.remove()
    app = null

    const noLink = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    expect(noLink.querySelector("a[href]")).toBeNull()
  })

  it("invalid envelope keeps raw XML visible", () => {
    const partial = '<drive-coding-msg version="1" source="agent"><sender id="'
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: partial }]),
      agents: [],
    })
    expect(root.textContent).toContain(partial)
    expect(root.textContent).toContain("driveMessage.envelope.partial")
  })

  it("context stays collapsed in details without open attribute", () => {
    const raw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      context: { kind: "project-charter", text: "CHARTER-PLAIN" },
      body: "b",
    })
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    const details = root.querySelector("details.drive-msg-context")
    expect(details).not.toBeNull()
    expect(details?.hasAttribute("open")).toBe(false)
    expect(root.textContent).toContain("CHARTER-PLAIN")
    expect(root.querySelector(".drive-msg-context-text")?.textContent).toContain("CHARTER-PLAIN")
  })

  it("system event headline, quote truncation, no empty quote block", () => {
    const withQuote = serializeDriveMessage({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID, name: "Subj" },
      at: 1_800_000_000_000,
      lastAssistantText: { text: "quoted words", truncated: true },
    })
    const qRoot = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: withQuote }]),
      agents: [],
    })
    expect(qRoot.textContent).toContain("driveMessage.system.quoteSection")
    expect(qRoot.textContent).toContain("quoted words")
    expect(qRoot.textContent).toContain("driveMessage.system.quoteTruncated")

    if (app !== null) unmount(app)
    qRoot.remove()
    app = null

    const noQuote = serializeDriveMessage({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID },
      at: 1,
    })
    const nRoot = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: noQuote }]),
      agents: [],
    })
    expect(nRoot.textContent?.includes("driveMessage.system.quoteSection")).toBe(false)
  })

  it("summary elements are present for accessibility", () => {
    const raw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "n" },
      body: "b",
    })
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    for (const summary of root.querySelectorAll("summary")) {
      expect((summary.textContent?.trim().length ?? 0) > 0).toBe(true)
    }
    const copyBtn = root.querySelector('button[aria-label^="bubble."]')
    expect(copyBtn).not.toBeNull()
  })

  it("regression: attachments and content placeholders render", () => {
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: "plain user text" }], {
        attachments: [{ mimeType: "image/png", dataBase64: "abc" }],
        contentPlaceholders: [{ kind: "resource_link", label: "file.txt", uri: "/x" }],
      }),
      agents: [],
    })
    expect(root.querySelector("img")).not.toBeNull()
    expect(root.textContent).toContain("file.txt")
  })

  it("reacts when agents array changes after mount", () => {
    const raw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Snap" },
      body: "b",
    })
    mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    expect(target?.querySelector("a[href]")).toBeNull()

    envelopeHarnessControls.setAgents([
      makeAgent({ id: AGENT_ID, cliKind: "cursor", acpSessionId: "sess-live" }),
    ])
    flushSync()
    expect(target?.querySelector('a[href="/chat/cursor/sess-live"]')).not.toBeNull()

    envelopeHarnessControls.setAgents([])
    flushSync()
    expect(target?.querySelector("a[href]")).toBeNull()
    expect(target?.textContent).toContain("Snap")
  })

  it("streaming chunks on same bubble without remount", () => {
    const full = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Stream" },
      body: "done",
    })
    const mid = Math.floor(full.length / 2)
    const partA = full.slice(0, mid)
    const partB = full.slice(mid)

    mountEnvelope({
      bubble: userBubble([{ id: "s1", text: partA }]),
      agents: [],
    })
    expect(target?.textContent).toContain("driveMessage.envelope.partial")
    expect(target?.textContent).toContain(partA)

    envelopeHarnessControls.setBubble({
      ...harnessState.bubble,
      segments: [
        { id: "s1", text: partA },
        { id: "s2", text: partB },
      ],
    })
    flushSync()
    expect(target?.textContent).toContain("driveMessage.agent.label")
    expect(target?.textContent).toContain("Stream")
    expect(target?.textContent).toContain("done")
    expect(target?.textContent).toContain(full)
  })

  it("entity split inside partial envelope stays literal until complete", () => {
    const full = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Ent" },
      body: "a & b",
    })
    const ampIdx = full.indexOf("&amp;")
    expect(ampIdx).toBeGreaterThan(0)
    const partA = full.slice(0, ampIdx + 5)
    const partB = full.slice(ampIdx + 5)

    mountEnvelope({
      bubble: userBubble([{ id: "s1", text: partA }]),
      agents: [],
    })
    expect(target?.textContent).toContain("driveMessage.envelope.partial")

    envelopeHarnessControls.setBubble({
      ...harnessState.bubble,
      segments: [
        { id: "s1", text: partA },
        { id: "s2", text: partB },
      ],
    })
    flushSync()
    expect(target?.textContent).toContain("Ent")
    expect(target?.textContent).toContain("a & b")
  })
})
