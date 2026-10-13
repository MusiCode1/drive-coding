// @vitest-environment jsdom
/**
 * user-bubble-envelope.test.ts — DOM harness for envelope rendering (slice agent-message-envelope-ui C1).
 */

import { serializeDriveMessage } from "@drive-coding/core/acp/drive-message-envelope"
import type { AgentPublic } from "@drive-coding/core/schemas/agent"
import { flushSync, mount, unmount } from "svelte"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { UserBubble } from "$lib/types/bubble"
import * as clipboard from "$lib/util/clipboard"
import EnvelopeHarness, {
  clearViewerCalls,
  type EnvelopeHarnessState,
  envelopeHarnessControls,
  getViewerCalls,
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

  it("segments.push on same bubble updates DOM without remount", () => {
    const full = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Stream" },
      body: "done",
    })
    const mid = Math.floor(full.length / 2)
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: full.slice(0, mid) }]),
      agents: [],
    })
    expect(root.textContent).toContain("driveMessage.envelope.partial")
    const outerBefore = root.querySelector(".user-bubble-outer")

    const b = envelopeHarnessControls.getBubble()
    const idBefore = b
    b.segments.push({ id: "s2", text: full.slice(mid) })
    flushSync()

    expect(root.textContent).toContain("driveMessage.agent.label")
    expect(root.textContent).toContain("Stream")
    expect(root.textContent).toContain("done")
    expect(root.querySelector(".user-bubble-outer")).toBe(outerBefore)
    expect(envelopeHarnessControls.getBubble()).toBe(idBefore)
    expect(b.segments.length).toBe(2)
  })

  it("in-place segment.text += on same segment updates DOM", () => {
    const full = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Mut" },
      body: "tail",
    })
    const mid = Math.floor(full.length / 2)
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: full.slice(0, mid) }]),
      agents: [],
    })
    expect(root.textContent).toContain("driveMessage.envelope.partial")

    const b = envelopeHarnessControls.getBubble()
    const segBefore = b.segments[0]
    if (segBefore === undefined) {
      throw new Error("expected segments[0] before in-place mutation")
    }
    if (typeof segBefore.text !== "string") {
      throw new Error("expected segments[0].text to be string")
    }
    const outerBefore = root.querySelector(".user-bubble-outer")
    segBefore.text += full.slice(mid)
    flushSync()

    expect(root.textContent).toContain("driveMessage.agent.label")
    expect(root.textContent).toContain("tail")
    expect(b.segments[0]).toBe(segBefore)
    expect(b.segments.length).toBe(1)
    expect(root.querySelector(".user-bubble-outer")).toBe(outerBefore)
  })

  it("entity split inside &amp; decodes after in-place push", () => {
    const full = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Ent" },
      body: "a & b",
    })
    const ampIdx = full.indexOf("&amp;")
    expect(ampIdx).toBeGreaterThan(0)
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: full.slice(0, ampIdx + 2) }]),
      agents: [],
    })
    expect(root.textContent).toContain("driveMessage.envelope.partial")
    expect(root.textContent).toContain("&a")

    envelopeHarnessControls.getBubble().segments.push({ id: "s2", text: full.slice(ampIdx + 2) })
    flushSync()
    expect(root.textContent).toContain("Ent")
    expect(root.textContent).toContain("a & b")
  })

  it("agent body: relative path is not linkified, absolute paths are", () => {
    const raw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "Linky" },
      body: "see ./rel.md and /tmp/abs.md and file:///etc/hosts",
    })
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    const links = root.querySelectorAll(".drive-msg-origin .file-link")
    expect(links.length).toBe(2)
    expect(root.textContent).toContain("./rel.md")
    expect([...links].map((l) => l.textContent)).toEqual(
      expect.arrayContaining(["/tmp/abs.md", "file:///etc/hosts"]),
    )
  })

  it("system quote: relative not linkified, absolute linkified", () => {
    const raw = serializeDriveMessage({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID, name: "Subj" },
      at: 1,
      lastAssistantText: { text: "./q.md then /var/q.md", truncated: false },
    })
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    const quote = root.querySelector(".drive-msg-quote")
    expect(quote?.querySelectorAll(".file-link").length).toBe(1)
    expect(quote?.textContent).toContain("./q.md")
    expect(quote?.querySelector(".file-link")?.textContent).toBe("/var/q.md")
  })

  it("system context is collapsed plaintext with < and markdown chars", () => {
    const ctxText = "line1\n# not-heading\n<script>x</script>"
    const raw = serializeDriveMessage({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID, name: "Subj" },
      at: 1,
      context: { kind: "project-charter", text: ctxText },
    })
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    const details = root.querySelector("details.drive-msg-context")
    expect(details?.hasAttribute("open")).toBe(false)
    expect(root.querySelector(".drive-msg-context-text")?.textContent).toContain("# not-heading")
    expect(root.querySelector(".drive-msg-quote .md-content strong")).toBeNull()
  })

  it("turn-ended error headline still shows subject name and optional link", () => {
    const rawNamed = serializeDriveMessage({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID, name: "ErrSubj" },
      at: 1,
      lastTurnError: { message: "boom" },
    })
    const named = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: rawNamed }]),
      agents: [makeAgent({ id: AGENT_ID, cliKind: "cursor", acpSessionId: "sess-err" })],
    })
    expect(named.textContent).toContain("ErrSubj")
    expect(named.textContent).toContain("driveMessage.system.turnEndedError")
    expect(named.querySelector('a[href="/chat/cursor/sess-err"]')).not.toBeNull()

    if (app !== null) unmount(app)
    named.remove()
    app = null

    const rawId = serializeDriveMessage({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID },
      at: 1,
      lastTurnError: { message: "boom" },
    })
    const idOnly = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: rawId }]),
      agents: [],
    })
    expect(idOnly.textContent).toContain("11111111…")
    expect(idOnly.querySelector("a[href]")).toBeNull()
  })

  it("quote renders markdown bold via MarkdownContent", () => {
    const raw = serializeDriveMessage({
      source: "system",
      eventKind: "turn-ended",
      subjectAgent: { id: AGENT_ID, name: "Subj" },
      at: 1,
      lastAssistantText: { text: "say **bold** word", truncated: false },
    })
    const root = mountEnvelope({
      bubble: userBubble([{ id: "s1", text: raw }]),
      agents: [],
    })
    const strong = root.querySelector(".drive-msg-quote .md-content strong")
    expect(strong).not.toBeNull()
    expect(strong?.textContent).toBe("bold")
  })

  it("fileLinks cwd updates after mount for relative path in plain bubble", async () => {
    clearViewerCalls()
    mountEnvelope({
      bubble: userBubble([{ id: "s1", text: "see ./notes.md here" }]),
      agents: [],
    })
    envelopeHarnessControls.setSessionCwd("/tmp/first")
    flushSync()
    const btn = target?.querySelector<HTMLButtonElement>(".file-link")
    expect(btn).not.toBeNull()
    btn?.click()
    await Promise.resolve()
    expect(getViewerCalls().some((c) => c.kind === "file" && c.uri?.includes("/tmp/first"))).toBe(
      true,
    )

    clearViewerCalls()
    envelopeHarnessControls.setSessionCwd("/tmp/second")
    flushSync()
    btn?.click()
    await Promise.resolve()
    expect(getViewerCalls().some((c) => c.kind === "file" && c.uri?.includes("/tmp/second"))).toBe(
      true,
    )
  })

  it("copy button writes exact raw envelope for agent, system, and invalid", async () => {
    const copySpy = vi.spyOn(clipboard, "copyToClipboard").mockResolvedValue(true)

    const agentRaw = serializeDriveMessage({
      source: "agent",
      sender: { id: AGENT_ID, name: "CopyAgent" },
      body: "body",
    })
    mountEnvelope({ bubble: userBubble([{ id: "s1", text: agentRaw }]), agents: [] })
    target
      ?.querySelector('button[aria-label="bubble.copy"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    expect(copySpy).toHaveBeenLastCalledWith(agentRaw)

    copySpy.mockClear()
    if (app !== null) unmount(app)
    target?.remove()
    app = null

    const systemRaw = serializeDriveMessage({
      source: "system",
      eventKind: "stall-suspected",
      subjectAgent: { id: AGENT_ID },
      at: 9,
    })
    mountEnvelope({ bubble: userBubble([{ id: "s1", text: systemRaw }]), agents: [] })
    target
      ?.querySelector('button[aria-label="bubble.copy"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    expect(copySpy).toHaveBeenLastCalledWith(systemRaw)

    copySpy.mockClear()
    if (app !== null) unmount(app)
    target?.remove()
    app = null

    const partial = '<drive-coding-msg version="1" source="agent"><sender id="x"'
    mountEnvelope({ bubble: userBubble([{ id: "s1", text: partial }]), agents: [] })
    target
      ?.querySelector('button[aria-label="bubble.copy"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    expect(copySpy).toHaveBeenLastCalledWith(partial)

    const sourcePre = target?.querySelector(".drive-msg-raw, .drive-envelope-raw")
    expect(sourcePre?.textContent).toContain(partial)

    copySpy.mockRestore()
  })
})
