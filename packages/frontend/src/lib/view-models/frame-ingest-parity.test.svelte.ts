/**
 * @vitest-environment jsdom
 * frame-ingest-parity.test.svelte.ts — gates G1–G6 for frame-ingest + meta-passthrough.
 *
 * The same host frames replay a recorded conversation through both transports.
 * Batching the updates independently checks the reader's version watermark.
 */

import { readFileSync } from "node:fs"
import { URL as NodeURL } from "node:url"
import {
  applyPatch,
  createInitialSessionState,
  decodeWsClientMessage,
  encodeWsFrame,
  encodeWsServerResponse,
  type Patch,
  reduce,
  type SessionState,
  type SseFrame,
  serializeFrame,
  snapshotFrame,
  TOOL_OUTPUT_TEXT_CAP,
  type ToolOutputRules,
  updateFrame,
} from "@drive-coding/core/session"
import { OrderAllocator } from "@drive-coding/core/voice/tts-queue"
import { flushSync, mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ToolBubbleHarness from "$lib/components/chat/bubbles/__tests__/tool-bubble-output-harness.svelte"
import SessionModeSelectHarness from "$lib/components/layout/__tests__/session-mode-select-harness.svelte"
import { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
import type { AudioSink } from "$lib/engines/audio-sink"
import { fakeSessionSockets } from "$lib/session/__contract__/fake-session-socket"
import { createRemoteSessionView, createRemoteView } from "$lib/session/create-session-view"
import type { SessionTransport } from "$lib/session/session-transport"
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

const replayState = createInitialSessionState({ sessionId: "parity-test" })

function* inboundUpdates() {
  for (const entry of inbound) {
    if (entry.channel === "acp" && entry.frame.method === "session/update") {
      yield rawUpdate(entry)
    } else if (entry.channel === "raw" && entry.frame.method === "_claude/sdkMessage") {
      yield {
        sessionUpdate: "_drive/ext_notification",
        method: entry.frame.method,
        params: entry.frame.params,
      }
    }
  }
}

function hostFrames(
  state: SessionState,
  updates: Iterable<unknown>,
  opts?: Parameters<typeof reduce>[2],
) {
  const frames: SseFrame[] = []
  for (const update of updates) {
    const next = reduce(state, update, opts)
    for (const patch of next.patches) {
      state = applyPatch(state, patch)
      const frame = updateFrame(state, patch)
      if (frame) frames.push(frame)
    }
    state = next.state
  }
  return frames
}

function notifications(frames: readonly SseFrame[]): { params: { update: unknown } }[] {
  return frames.flatMap((frame) => JSON.parse(frame.data) as { params: { update: unknown } }[])
}

const dripFrames = hostFrames(replayState, inboundUpdates())
const wireNotifications = notifications(dripFrames)
const batchedFrame: SseFrame = {
  event: "update",
  id: dripFrames.at(-1)?.id,
  data: JSON.stringify(wireNotifications),
}

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

vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "" })
let uuidCounter = 0
vi.stubGlobal("crypto", { randomUUID: () => `test-uuid-${uuidCounter++}` })

import { AgentSession } from "./agent-session.svelte"
import { Settings } from "./settings.svelte"
import { Speaker } from "./speaker.svelte"

// ─── feed runners ───────────────────────────────────────────────────────────

async function connectFrameFeed(
  transport: SessionTransport,
  state: SessionState,
  onRpc?: (body: unknown) => void,
) {
  const initial = snapshotFrame(state)
  const opts = { agentId: "parity-agent", baseUrl: "http://be.local", transport }
  if (transport === "ws") {
    const sockets = fakeSessionSockets()
    const connecting = createRemoteView({ ...opts, _WebSocket: sockets.WebSocket })
    const socket = sockets.latest()
    const push = (frame: SseFrame) => socket.receive(encodeWsFrame(frame))
    if (onRpc) {
      const send = socket.send.bind(socket)
      socket.send = (data) => {
        send(data)
        const message = decodeWsClientMessage(data)
        if (message?.kind !== "request") return
        onRpc(message.request.params)
        socket.receive(encodeWsServerResponse(message.request.id, { status: 202, body: {} }))
      }
    }
    socket.connect()
    push(initial)
    return { view: await connecting, push }
  }

  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const push = (frame: SseFrame) => controller.enqueue(encoder.encode(serializeFrame(frame)))
  const view = await createRemoteView({
    ...opts,
    _fetch: async (url, init) => {
      if (onRpc && init?.method === "POST") {
        expect(url).toBe("http://be.local/api/agents/parity-agent/rpc")
        onRpc(JSON.parse(String(init.body)))
        return Response.json({}, { status: 202 })
      }
      expect(url).toBe("http://be.local/api/agents/parity-agent/events")
      init?.signal?.addEventListener("abort", () => controller.close(), { once: true })
      push(initial)
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
    },
  })
  return { view, push }
}

const modeChoices = [
  { id: "review", name: "Auto review" },
  { id: "read-only", name: "Read-only" },
]
const modeConfig = {
  type: "select",
  id: "approval",
  name: "Mode",
  category: "mode",
  currentValue: "review",
  options: modeChoices.map(({ id, name }) => ({ value: id, name })),
} as const
const legacyModes = { currentModeId: "review", availableModes: modeChoices }

describe.each(["http", "ws"] as const)("mode selector contract (%s)", (transport) => {
  it("renders a config change sent by a second viewer while legacy modes stay stale", async () => {
    const state = {
      ...replayState,
      configOptions: [{ ...modeConfig, options: [...modeConfig.options] }],
      modes: legacyModes,
    }
    const observer = await connectFrameFeed(transport, state)
    const rpc = vi.fn((body: unknown) => {
      expect(body).toEqual({
        method: "session/set_config_option",
        params: { sessionId: state.sessionId, configId: "approval", value: "read-only" },
      })
      for (const frame of hostFrames(state, [
        {
          sessionUpdate: "config_option_update",
          configOptions: [{ ...modeConfig, currentValue: "read-only" }],
        },
      ]))
        observer.push(frame)
    })
    const sender = await connectFrameFeed(transport, state, rpc)
    const initiatingAgent = new AgentSession({ view: sender.view })
    initiatingAgent._setStatusForTest("connected")
    const agent = new AgentSession({ view: observer.view })
    const target = document.createElement("div")
    const app = mount(SessionModeSelectHarness, { target, props: { agent } })
    const displayed = () => target.querySelector("button")?.textContent?.trim()
    try {
      flushSync()
      expect(displayed()).toBe("Auto review")
      await initiatingAgent.applyConfigOption("approval", "read-only")
      expect(rpc).toHaveBeenCalledTimes(1)
      await vi.waitFor(() =>
        expect(agent.configOptions[0]).toMatchObject({ currentValue: "read-only" }),
      )
      expect(agent.modes?.currentModeId).toBe("review")
      await tick()
      expect(displayed()).toBe("Read-only")
    } finally {
      await unmount(app)
      await Promise.all([observer.view.close(), sender.view.close()])
    }
  })

  it("uses legacy currentModeId when the CLI omits a mode config option", async () => {
    const { view } = await connectFrameFeed(transport, {
      ...replayState,
      modes: { ...legacyModes, currentModeId: "read-only" },
    })
    const agent = new AgentSession({ view })
    const target = document.createElement("div")
    const app = mount(SessionModeSelectHarness, { target, props: { agent } })
    try {
      flushSync()
      expect(target.querySelector("button")?.textContent?.trim()).toBe("Read-only")
    } finally {
      await unmount(app)
      await view.close()
    }
  })
})

async function runReplay(
  transport: SessionTransport,
  frames: readonly SseFrame[],
  state = replayState,
) {
  const observed: unknown[] = []
  const { view, push } = await connectFrameFeed(transport, state)
  const agent = new AgentSession({ view, _onUpdateObserved: (update) => observed.push(update) })
  agent._setStatusForTest("connected")
  try {
    const expectedCount = notifications(frames).length
    for (const frame of frames) push(frame)
    await vi.waitFor(() => expect(observed).toHaveLength(expectedCount))
    return { observed, bubbles: [...agent.bubbles] }
  } finally {
    await view.close()
  }
}

describe("frame-ingest parity gate", () => {
  beforeEach(() => {
    uuidCounter = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("G1 — every host update reaches the VM over SSE and WebSocket", async () => {
    expect(wireNotifications.length).toBeGreaterThan(0)
    const sse = await runReplay("http", [batchedFrame])
    const ws = await runReplay("ws", dripFrames)
    expect(sse.observed).toEqual(wireNotifications.map((entry) => entry.params.update))
    expect(sse.observed).toEqual(ws.observed)
  })

  it("G2 — batched and streamed host frames produce the same bubbles", async () => {
    const sse = await runReplay("http", [batchedFrame])
    const drip = await runReplay("http", dripFrames)
    const ws = await runReplay("ws", dripFrames)
    expect(flatShapes(sse.bubbles)).toEqual(flatShapes(drip.bubbles))
    expect(flatShapes(sse.bubbles)).toEqual(flatShapes(ws.bubbles))
  })

  it("G3 — the top-level tool count matches over SSE and WebSocket", async () => {
    const ws = await runReplay("ws", dripFrames)
    const sse = await runReplay("http", [batchedFrame])
    expect(toolShapes(sse.bubbles).length).toBeGreaterThan(0)
    expect(toolShapes(sse.bubbles)).toHaveLength(toolShapes(ws.bubbles).length)
  })

  it("G4 — message text matches over SSE and WebSocket", async () => {
    const ws = await runReplay("ws", dripFrames)
    const sse = await runReplay("http", [batchedFrame])
    expect(flatMessageTexts(sse.bubbles)).toEqual(flatMessageTexts(ws.bubbles))
  })

  it("G5 — tool shapes match field-for-field over SSE and WebSocket", async () => {
    const ws = await runReplay("ws", dripFrames)
    const sse = await runReplay("http", [batchedFrame])
    expect(toolShapes(sse.bubbles)).toEqual(toolShapes(ws.bubbles))
  })

  it("G6 — both transports preserve the Task bubble's subagent data", async () => {
    const ws = await runReplay("ws", dripFrames)
    const sse = await runReplay("http", [batchedFrame])
    const wsTask = ws.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    const sseTask = sse.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === TASK_TOOL_CALL_ID,
    )
    expect(wsTask?.kind === "tool" && wsTask.toolCall.task).toBeTruthy()
    expect(sseTask?.kind === "tool" && sseTask.toolCall.task).toEqual(
      wsTask?.kind === "tool" ? wsTask.toolCall.task : undefined,
    )
  })
})

const terminalTail = "part 1\npart 2\n"
const mcpText = "MCP tool returned its content"
const terminal = { sessionUpdate: "tool_call_update", toolCallId: "terminal" }
const codexUpdates = [
  {
    sessionUpdate: "tool_call",
    toolCallId: "terminal",
    kind: "execute",
    title: "Run command",
    _meta: { terminal_info: { terminal_id: "t1" } },
  },
  {
    ...terminal,
    _meta: { terminal_output_delta: { data: `${"x".repeat(TOOL_OUTPUT_TEXT_CAP)}\npart 1\n` } },
  },
  { ...terminal, _meta: { terminal_output_delta: { data: "part 2\n" } } },
  { ...terminal, status: "failed", _meta: { terminal_exit: { exit_code: 3 } } },
  {
    sessionUpdate: "tool_call",
    toolCallId: "mcp",
    title: "Lookup",
    status: "completed",
    _meta: { is_mcp_tool_call: true },
    rawOutput: { error: null, result: { content: [{ type: "text", text: mcpText }] } },
  },
]
// Rules for the synthetic host input above.
const codexRules: ToolOutputRules = {
  fields: {
    text: [
      { from: "meta", key: "terminal_output_delta", path: ["data"] },
      { from: "raw", path: ["result", "content", 0, "text"] },
    ],
    exitCode: [{ from: "meta", key: "terminal_exit", path: ["exit_code"] }],
  },
  metaKeys: {
    terminal_info: "replace",
    terminal_output_delta: "append",
    terminal_exit: "replace",
    is_mcp_tool_call: "replace",
  },
}
const codexState = createInitialSessionState({ sessionId: "codex-tools" })

async function readRenderedTools(transport: SessionTransport, canonicalOutput: boolean) {
  const frames = hostFrames(codexState, codexUpdates, {
    toolOutput: canonicalOutput ? codexRules : undefined,
  })
  const { bubbles } = await runReplay(transport, frames, codexState)
  const rendered = []
  for (const bubble of bubbles) {
    if (bubble.kind !== "tool") throw new Error("Expected a tool bubble")
    const target = document.createElement("div")
    const app = mount(ToolBubbleHarness, { target, props: { bubble } })
    try {
      flushSync()
      expect(target.querySelector("details")?.open).toBe(true)
      rendered.push({
        id: bubble.toolCall.toolCallId,
        text: target.querySelector(".tool-text-wrapper pre")?.textContent,
        exitCode: target.querySelector(".exit-chip")?.textContent?.trim(),
        notice: target.querySelector(".output-truncated")?.textContent,
      })
    } finally {
      await unmount(app)
    }
  }
  return rendered
}

const expectedCodexOutput = [
  {
    id: "terminal",
    text: terminalTail,
    exitCode: "chat.tool.output.exitCode: 3",
    notice: "chat.tool.output.truncatedHead",
  },
  { id: "mcp", text: mcpText, exitCode: undefined, notice: undefined },
]

it.each(["http", "ws"] as const)(
  "renders Codex terminal and MCP output over %s",
  async (transport) => {
    expect(await readRenderedTools(transport, true)).toEqual(expectedCodexOutput)
  },
)

it("detects missing canonical host output in the rendered bubbles", async () => {
  const rendered = await readRenderedTools("ws", false)
  expect(rendered).toEqual([
    { id: "terminal", text: undefined, exitCode: undefined, notice: undefined },
    { id: "mcp", text: undefined, exitCode: undefined, notice: undefined },
  ])
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
    {
      label: "does not enqueue restored history for speech after the RPC returns",
      withSpeaker: true,
    },
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

      const switching = agent.switchSession({
        sessionId: "failed",
        cwd: "/test",
        cliKind: "claude",
      })
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
