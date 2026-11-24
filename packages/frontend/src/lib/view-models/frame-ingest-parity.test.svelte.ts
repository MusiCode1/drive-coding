/**
 * @vitest-environment jsdom
 * frame-ingest-parity.test.svelte.ts — gates G1–G6 for frame-ingest + meta-passthrough.
 *
 * Three feeds of the same recorded conversation (ACP session/update + _claude/sdkMessage):
 *   A — WS: reducer and host frames → RemoteSessionView (drip)
 *   B — HTTP: patchToSessionUpdates synthesis → RemoteSessionView (snapshot batch)
 *   C — HTTP: patchToSessionUpdates synthesis → RemoteSessionView (drip batches)
 *
 * G3 compares top-level tool-bubble counts (not flat bubble count — slice meta-passthrough:
 * HTTP had an extra orphan tool bubble that cancelled WS message duplication on the old G3).
 */

import { readFileSync } from "node:fs"
import { URL as NodeURL } from "node:url"
import {
  applyPatch,
  createInitialSessionState,
  encodeWsFrame,
  type Patch,
  patchToSessionUpdates,
  reduce,
  serializeFrame,
  snapshotFrame,
  type SessionState,
  type SseFrame,
  updateFrame,
  type WireSessionUpdate,
} from "@drive-coding/core/session"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { tick } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import { fakeSessionSockets } from "$lib/session/__contract__/fake-session-socket"
import { createRemoteSessionView, createRemoteView } from "$lib/session/create-session-view"
import type { SessionView, ViewEmission } from "$lib/session/session-view"
import type { WireUpdateBatch } from "$lib/session/sse-reader"
import type { Bubble } from "$lib/types/bubble"

// ─── fixture ────────────────────────────────────────────────────────────────

type FixtureEntry = {
  dir: string
  channel: string
  frame: { method?: string; params?: unknown }
}

const fixturePath = new NodeURL(
  "../../../../core/tests/fixtures/subagent-task-single.json",
  import.meta.url,
)
const fixture: FixtureEntry[] = JSON.parse(readFileSync(fixturePath, "utf-8"))

// ‏slice meta-passthrough Commit 5: ‏שני המסלולים צורכים את **‏כל** ‏הפריימים הנכנסים
// (‏`session/update` ‏**‏וגם** ‏`_claude/sdkMessage`), ‏ולכן אין יותר סינון מוקדם ל-acp בלבד.
const inbound = fixture.filter((e) => e.dir === "in")
const TASK_TOOL_CALL_ID = "toolu_01GiSAsvUBjALq1WGBB2xQ1K"

function rawUpdate(entry: FixtureEntry): unknown {
  return (entry.frame.params as { update: unknown }).update
}

// ─── HTTP replay view (mirrors RemoteSessionView.#applyIncoming) ────────────

class HttpReplayView implements SessionView {
  state: SessionState = $state(createInitialSessionState({ sessionId: null }))

  #controller: ReadableStreamDefaultController<ViewEmission> | null = null
  readonly patches: ReadableStream<ViewEmission>
  #lastVersion = 0
  supportsSessionDelete = false

  constructor() {
    this.patches = new ReadableStream<ViewEmission>({
      start: (controller) => {
        this.#controller = controller
      },
    })
  }

  connect(sessionId: string): void {
    this.state = { ...this.state, sessionId, status: "connected" }
  }

  applyIncoming(batch: WireUpdateBatch): void {
    if (batch.version <= this.#lastVersion) return
    let state = this.state
    const produced: Patch[] = []
    for (const update of batch.updates) {
      const { state: next, patches } = reduce(state, update)
      state = next
      produced.push(...patches)
    }
    this.state = { ...state, version: batch.version }
    this.#lastVersion = batch.version
    if (produced.length > 0 || batch.updates.length > 0) {
      this.#emit(produced, batch.updates)
    }
  }

  #emit(patches: Patch[], updates: unknown[] = []): void {
    try {
      this.#controller?.enqueue({ patches, updates })
    } catch {
      // stream closed
    }
  }

  prompt = vi.fn().mockResolvedValue(undefined)
  cancel = vi.fn().mockResolvedValue(undefined)
  respond = vi.fn().mockResolvedValue(undefined)
  setMode = vi.fn().mockResolvedValue(undefined)
  setConfigOption = vi.fn().mockResolvedValue(undefined)
  extMethod = vi.fn().mockResolvedValue(undefined)
  newSession = vi.fn().mockResolvedValue(undefined)
  loadSession = vi.fn().mockResolvedValue(undefined)
  listSessions = vi.fn().mockResolvedValue([])
  deleteSession = vi.fn().mockResolvedValue(undefined)
  setSessionModel = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockResolvedValue(undefined)
}

// ─── wire synthesis (BE path: reduce → Patch → patchToSessionUpdates + ext wrapper) ─

function synthesizeWireFromInbound(mode: "snapshot" | "drip"): {
  batches: WireUpdateBatch[]
  wireCount: number
} {
  let state = createInitialSessionState({ sessionId: "parity-test" })
  let version = 0
  const allWire: WireSessionUpdate[] = []
  const batches: WireUpdateBatch[] = []

  for (const entry of inbound) {
    let batchWire: WireSessionUpdate[] = []

    if (entry.channel === "acp" && entry.frame.method === "session/update") {
      const update = rawUpdate(entry)
      const { state: next, patches } = reduce(state, update)
      for (const patch of patches) {
        const applied = applyPatch(state, patch)
        if (applied) {
          batchWire.push(...patchToSessionUpdates(applied, patch))
          state = applied
        }
      }
      state = next
    } else if (entry.channel === "raw" && entry.frame.method === "_claude/sdkMessage") {
      batchWire.push({
        sessionUpdate: "_drive/ext_notification",
        method: "_claude/sdkMessage",
        params: entry.frame.params as Record<string, unknown>,
      })
    } else {
      continue
    }

    version++
    allWire.push(...batchWire)
    if (mode === "drip" && batchWire.length > 0) {
      batches.push({ version, updates: batchWire })
    }
  }

  if (mode === "snapshot") {
    batches.push({ version, updates: allWire })
  }

  return { batches, wireCount: allWire.length }
}

const { batches: snapshotBatches, wireCount: expectedWireCount } =
  synthesizeWireFromInbound("snapshot")
const { batches: dripBatches } = synthesizeWireFromInbound("drip")

// ─── bubble helpers (flat top-level; subFrames excluded per brief §4) ───────

type BubbleShape = { role: string; kind: string; toolCallId?: string }

function bubbleShape(b: Bubble): BubbleShape {
  if (b.kind === "user") return { role: "user", kind: "user" }
  if (b.kind === "message") return { role: "assistant", kind: "message" }
  if (b.kind === "thought") return { role: "assistant", kind: "thought" }
  return { role: "tool", kind: "tool", toolCallId: b.toolCall.toolCallId }
}

function flatShapes(bubbles: Bubble[]): BubbleShape[] {
  return bubbles.map(bubbleShape)
}

function flatMessageTexts(bubbles: Bubble[]): string[] {
  const out: string[] = []
  for (const b of bubbles) {
    if (b.kind === "message" || b.kind === "thought" || b.kind === "user") {
      out.push(b.segments.map((s) => s.text).join(""))
    }
  }
  return out
}

/** Top-level tool bubble shapes including nesting depth — what G3/G5 measure (meta-passthrough). */
type ToolShape = { toolCallId: string; subFrames: number; isTask: boolean }

function toolShapes(bubbles: Bubble[]): ToolShape[] {
  return bubbles
    .filter((b): b is Bubble & { kind: "tool" } => b.kind === "tool")
    .map((b) => ({
      toolCallId: b.toolCall.toolCallId,
      subFrames: b.subFrames?.length ?? 0,
      isTask: (b.subFrames?.length ?? 0) > 0,
    }))
}

function delay(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "parity-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
}))

vi.mock("./speaker-fetch-job", () => ({
  executeSpeakerFetchJob: vi.fn().mockResolvedValue({ kind: "abandoned" }),
}))

vi.mock("$lib/adapters/ext", () => ({
  createExtClient: vi.fn(() => ({
    setThinkingTokens: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
let uuidCounter = 0
vi.stubGlobal("crypto", { randomUUID: () => `test-uuid-${uuidCounter++}` })

import { AgentSession } from "./agent-session.svelte"
import { Settings } from "./settings.svelte"
import { Speaker } from "./speaker.svelte"

// ─── feed runners ───────────────────────────────────────────────────────────

async function runWsPath(): Promise<{ observed: unknown[]; bubbles: Bubble[] }> {
  const observed: unknown[] = []
  const sockets = fakeSessionSockets()
  let state = createInitialSessionState({ sessionId: "parity-test" })
  const connected = createRemoteView({
    agentId: "parity-agent",
    baseUrl: "http://be.local",
    transport: "ws",
    _WebSocket: sockets.WebSocket,
  })
  const socket = sockets.latest()
  socket.connect()
  socket.receive(encodeWsFrame(snapshotFrame(state)))
  const view = await connected
  const agent = new AgentSession({ view, _onUpdateObserved: (update) => observed.push(update) })
  try {
    let sent = 0
    for (const entry of inbound) {
      const update =
        entry.channel === "acp" && entry.frame.method === "session/update"
          ? rawUpdate(entry)
          : entry.channel === "raw" && entry.frame.method === "_claude/sdkMessage"
            ? {
                sessionUpdate: "_drive/ext_notification",
                method: entry.frame.method,
                params: entry.frame.params,
              }
            : undefined
      if (!update) continue
      const result = reduce(state, update)
      state = result.state
      for (const patch of result.patches) {
        const frame = updateFrame(state, patch)
        if (!frame) continue
        socket.receive(encodeWsFrame(frame))
        sent++
      }
    }
    expect(sent).toBeGreaterThan(0)
    await vi.waitFor(() => expect(view.state.version).toBe(state.version))
    await delay()
    expect(observed.length).toBeGreaterThan(0)
    return { observed, bubbles: [...agent.bubbles] }
  } finally {
    await view.close()
  }
}

async function runHttpPath(
  batches: WireUpdateBatch[],
): Promise<{ observed: unknown[]; bubbles: Bubble[] }> {
  const observed: unknown[] = []
  const view = new HttpReplayView()
  view.connect("http-parity-test")
  const agent = new AgentSession({ view, _onUpdateObserved: (u) => observed.push(u) })
  agent._setStatusForTest("connected")
  for (const batch of batches) {
    view.applyIncoming(batch)
  }
  await delay()
  return { observed, bubbles: [...agent.bubbles] }
}

// ─── G1–G4 ──────────────────────────────────────────────────────────────────

describe("frame-ingest parity gate", () => {
  beforeEach(() => {
    uuidCounter = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("G1 — every session/update on the HTTP wire is observed in #onSessionUpdate", async () => {
    const { observed } = await runHttpPath(snapshotBatches)
    expect(observed.length).toBe(expectedWireCount)
  })

  it("G2 — bubble structure in HTTP snapshot ≈ HTTP drip", async () => {
    const a = await runHttpPath(snapshotBatches)
    const b = await runHttpPath(dripBatches)
    expect(flatShapes(a.bubbles)).toEqual(flatShapes(b.bubbles))
  })

  it("G3 — no duplication: HTTP snapshot tool shapes count = WS tool shapes count", async () => {
    const ws = await runWsPath()
    const http = await runHttpPath(snapshotBatches)
    expect(toolShapes(http.bubbles).length).toBe(toolShapes(ws.bubbles).length)
  })

  it("G4 — message text in HTTP snapshot ≈ WS", async () => {
    const ws = await runWsPath()
    const http = await runHttpPath(snapshotBatches)
    // WS replay may re-emit a full-text chunk after partial chunks (fixture artifact);
    // HTTP wire synthesis collapses to whole messages — compare unique text content.
    const wsUnique = [...new Set(flatMessageTexts(ws.bubbles))].sort()
    const httpUnique = [...new Set(flatMessageTexts(http.bubbles))].sort()
    expect(httpUnique).toEqual(wsUnique)
  })

  it("G5 — HTTP snapshot tool shapes match WS field-for-field", async () => {
    const ws = await runWsPath()
    const http = await runHttpPath(snapshotBatches)
    expect(toolShapes(http.bubbles)).toEqual(toolShapes(ws.bubbles))
  })

  it("G6 — Task bubble carries toolCall.task on both WS and HTTP paths", async () => {
    const ws = await runWsPath()
    const http = await runHttpPath(snapshotBatches)
    const wsTask = ws.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    const httpTask = http.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    expect(wsTask?.kind === "tool" && wsTask.toolCall.task).toBeDefined()
    expect(httpTask?.kind === "tool" && httpTask.toolCall.task).toEqual(
      wsTask?.kind === "tool" ? wsTask.toolCall.task : undefined,
    )
  })
})

describe("failed session switch over HTTP", () => {
  const historyText = "This historical answer must stay silent on restore."
  const liveText = "This new reply must be spoken after the restoration."
  const partialText = "Discard this partial replay from the failed session."

  function message(messageId: string, text: string) {
    return { sessionUpdate: "agent_message", messageId, content: [{ type: "text", text }] }
  }

  function createSpeaker(session: AgentSession) {
    const settings = new Settings()
    settings.muted = false
    const sink: AudioSink = {
      prepareSegment: vi.fn(async () => {}),
      play: vi.fn(async () => {}),
      cancel: vi.fn(),
      clear: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    }
    return new Speaker({
      session,
      settings,
      playlist: new AudioPlaylist(sink),
      audioStream: sink,
      orderAlloc: new OrderAllocator(),
    })
  }

  it.each([
    { label: "restores text and tool bubbles", withSpeaker: false },
    { label: "does not enqueue restored history for speech after the RPC returns", withSpeaker: true },
  ])("$label", async ({ withSpeaker }) => {
    let state = createInitialSessionState({ sessionId: "original" })
    for (const update of [
      message("history", historyText),
      { sessionUpdate: "tool_call", toolCallId: "lookup", title: "Lookup", status: "completed" },
    ]) {
      state = reduce(state, update).state
    }
    state = { ...state, status: "connected", turnState: "idle" }
    const before = state
    const encoder = new TextEncoder()
    const sse = new TransformStream<Uint8Array>()
    const writer = sse.writable.getWriter()
    const send = (frame: SseFrame) => writer.write(encoder.encode(serializeFrame(frame)))
    const rpc = Promise.withResolvers<Response>()
    const view = createRemoteSessionView("restore-test", "http://be.local", {
      _fetch: async (url) =>
        url.endsWith("/events")
          ? new Response(sse.readable, { headers: { "Content-Type": "text/event-stream" } })
          : rpc.promise,
    })
    const connecting = view.connect()
    await send(snapshotFrame(before))
    await connecting
    const agent = new AgentSession({ view })
    agent._setStatusForTest("connected")
    const speaker = withSpeaker ? createSpeaker(agent) : undefined

    async function patch(p: Patch) {
      state = applyPatch(state, p)
      const frame = updateFrame(state, p)
      if (!frame) throw new Error(`Expected wire update for ${p.op}`)
      await send(frame)
    }

    async function append(update: ReturnType<typeof message>) {
      const { patches } = reduce(state, update)
      expect(patches).toHaveLength(1)
      for (const p of patches) await patch(p)
    }

    try {
      await vi.waitFor(() => expect(agent.bubbles).toHaveLength(2))
      const shapes = flatShapes(agent.bubbles)
      const texts = flatMessageTexts(agent.bubbles)
      const tools = toolShapes(agent.bubbles)
      expect(texts).toEqual([historyText])
      expect(tools).toMatchObject([{ toolCallId: "lookup" }])
      expect(speaker?.debugInfo().recent ?? []).toEqual([])

      const switching = agent.switchSession({ sessionId: "failed", cwd: "/test", cliKind: "claude" })
      expect(agent.isLoadingHistory).toBe(true)
      await patch({
        op: "reset",
        version: state.version + 1,
        messages: [],
        nextMessageSeq: 0,
        nextSegmentSeq: 0,
      })
      await vi.waitFor(() => expect(agent.bubbles).toHaveLength(0))
      state = { ...state, sessionId: "failed" }
      await append(message("partial", partialText))
      await vi.waitFor(() => expect(flatMessageTexts(agent.bubbles)).toEqual([partialText]))
      await tick()
      expect(speaker?.debugInfo().recent ?? []).toEqual([])

      rpc.resolve(Response.json({ error: "load failed", code: -32002 }, { status: 502 }))
      await switching
      expect(agent.isLoadingHistory).toBe(false)
      state = { ...state, sessionId: before.sessionId }
      await patch({
        op: "reset",
        version: state.version + 1,
        messages: before.messages,
        nextMessageSeq: before.nextMessageSeq,
        nextSegmentSeq: before.nextSegmentSeq,
      })
      await patch({
        op: "update-session",
        version: state.version + 1,
        changes: { turnState: "idle" },
      })
      await vi.waitFor(() => {
        expect(flatMessageTexts(agent.bubbles)).toEqual(texts)
        expect(agent.turnState).toBe("idle")
      })
      expect(flatShapes(agent.bubbles)).toEqual(shapes)
      expect(toolShapes(agent.bubbles)).toEqual(tools)

      if (speaker) {
        await tick()
        const restoredRecent = speaker.debugInfo().recent
        await append(message("live", liveText))
        await patch({
          op: "update-session",
          version: state.version + 1,
          changes: { turnState: "idle" },
        })
        await vi.waitFor(() => expect(speaker.debugInfo().recent).toContain(liveText))
        expect(restoredRecent).toEqual([])
        expect(speaker.debugInfo().recent).toEqual([liveText])
      }
    } finally {
      speaker?.destroy()
      await view.close()
    }
  })
})
