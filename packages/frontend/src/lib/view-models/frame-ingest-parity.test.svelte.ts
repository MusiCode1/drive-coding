/**
 * frame-ingest-parity.test.svelte.ts — gates G1–G6 for frame-ingest + meta-passthrough.
 *
 * Three feeds of the same recorded conversation (ACP session/update + _claude/sdkMessage):
 *   A — WS: raw frames → #onSessionUpdate / #onExtNotification (drip)
 *   B — HTTP: patchToSessionUpdates synthesis → RemoteSessionView (snapshot batch)
 *   C — HTTP: patchToSessionUpdates synthesis → RemoteSessionView (drip batches)
 *
 * G3 compares top-level tool-bubble counts (not flat bubble count — slice meta-passthrough:
 * HTTP had an extra orphan tool bubble that cancelled WS message duplication on the old G3).
 */

import { readFileSync } from "node:fs"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import {
  applyPatch,
  createInitialSessionState,
  type Patch,
  patchToSessionUpdates,
  reduce,
  type SessionState,
  type WireSessionUpdate,
} from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionView, ViewEmission } from "$lib/session/session-view"
import type { WireUpdateBatch } from "$lib/session/sse-reader"
import type { Bubble } from "$lib/types/bubble"

// ─── fixture ────────────────────────────────────────────────────────────────

type FixtureEntry = {
  dir: string
  channel: string
  frame: { method?: string; params?: unknown }
}

const fixturePath = new URL(
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

  resetTranscript(): void {
    this.state = {
      ...createInitialSessionState({ sessionId: this.state.sessionId }),
      status: "connected",
    }
    this.#emit([{ version: 2, op: "reset", nextMessageSeq: 0, nextSegmentSeq: 0, messages: [] }])
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

// ─── WS path mocks ──────────────────────────────────────────────────────────

let capturedOnUpdate: ((n: SessionNotification) => void) | null = null
let capturedOnExtNotification: ((method: string, params: Record<string, unknown>) => void) | null =
  null

/**
 * Resetting through a function, not inline `= null`: an inline assignment
 * narrows these module-level `let`s to `null` for the rest of the block, and
 * the later `capturedOnUpdate?.(…)` then reads as `never` — TS cannot see that
 * the mock reassigns them.
 */
function resetCaptured(): void {
  capturedOnUpdate = null
  capturedOnExtNotification = null
}

function makeMockClient(): AcpClient {
  return {
    conn: {} as AcpClient["conn"],
    capabilities: {} as AcpClient["capabilities"],
    newSession: vi.fn().mockResolvedValue({ sessionId: "ws-parity-test" }),
    loadSession: vi.fn().mockResolvedValue({}),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    setSessionConfigOption: vi.fn(),
    setSessionMode: vi.fn(),
    setSessionModel: vi.fn(),
    extMethod: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as AcpClient
}

vi.mock("@drive-coding/provider/client", async (importActual) => {
  const actual = await importActual<typeof import("@drive-coding/provider/client")>()
  return {
    ...actual,
    createAcpClient: vi.fn(
      (
        _transport: unknown,
        callbacks: {
          onUpdate: (n: SessionNotification) => void
          onExtNotification?: (method: string, params: Record<string, unknown>) => void
        },
      ) => {
        capturedOnUpdate = callbacks.onUpdate
        capturedOnExtNotification = callbacks.onExtNotification ?? null
        return Promise.resolve(makeMockClient())
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
  createAgent: vi.fn().mockResolvedValue({ agentId: "parity-agent" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
  patchAgent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("$lib/adapters/sessions", () => ({
  normalizeSessionInfo: vi.fn((x: unknown) => x),
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

// ─── feed runners ───────────────────────────────────────────────────────────

async function runWsPath(): Promise<{ observed: unknown[]; bubbles: Bubble[] }> {
  const observed: unknown[] = []
  resetCaptured()
  const agent = new AgentSession({ _onUpdateObserved: (u) => observed.push(u) })
  await agent.attach({ cwd: "/proj", cliKind: "claude" })
  for (const entry of inbound) {
    if (entry.channel === "acp" && entry.frame.method === "session/update") {
      capturedOnUpdate?.(entry.frame.params as SessionNotification)
    } else if (entry.channel === "raw" && entry.frame.method === "_claude/sdkMessage") {
      capturedOnExtNotification?.(
        "_claude/sdkMessage",
        entry.frame.params as Record<string, unknown>,
      )
    }
  }
  return { observed, bubbles: [...agent.bubbles] }
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
    capturedOnUpdate = null
    capturedOnExtNotification = null
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

// C1 exercises the live consumer with positive content assertions in each transport.
describe.each(["WS", "HTTP"] as const)("C1 %s classifier consumer", (transport) => {
  async function open() {
    const observations: Array<{ update: unknown; turn: string }> = []
    resetCaptured()
    const view = transport === "HTTP" ? new HttpReplayView() : undefined
    view?.connect("c1-http")
    const agent = new AgentSession({
      ...(view ? { view } : {}),
      _onUpdateObserved: (update) => observations.push({ update, turn: agent.turnState }),
    })
    if (view) agent._setStatusForTest("connected")
    else await agent.attach({ cwd: "/proj", cliKind: "claude" })
    let version = 0
    const emit = async (update: unknown) => {
      if (view) {
        view.applyIncoming({ version: ++version, updates: [update as WireSessionUpdate] })
        await delay()
      } else {
        expect(capturedOnUpdate).toBeTypeOf("function")
        capturedOnUpdate?.({ update } as SessionNotification)
      }
    }
    return { agent, emit, observations }
  }

  it.each([
    [{ type: "image", data: "c1-image", mimeType: "image/png" }, "image"],
    [{ type: "resource_link", name: "doc", uri: "file:///doc" }, "resource_link"],
    [{ type: "audio" }, "audio"],
    [{ type: "resource" }, "resource"],
    [null, "resource"],
    [undefined, "resource"],
    [[], "resource"],
  ] as const)("adopts optimistic bubble before attachment %#", async (content, kind) => {
    const { agent, emit, observations } = await open()
    agent.bubbles.push({
      id: "optimistic",
      kind: "user",
      messageId: null,
      createdAt: 0,
      segments: [],
    })
    const original = agent.bubbles[0]
    const update = { sessionUpdate: "user_message_chunk", messageId: "adopted", content }
    await emit(update)
    expect(observations.some((entry) => entry.update === update)).toBe(true)
    expect(agent.bubbles).toHaveLength(1)
    expect(agent.bubbles[0]).toBe(original)
    expect(original?.messageId).toBe("adopted")
    expect(original?.id).toBe("optimistic")
    if (original?.kind !== "user") throw Error("missing user")
    if (kind === "image") {
      expect(original.attachments).toEqual([{ mimeType: "image/png", dataBase64: "c1-image" }])
    } else {
      expect(original.contentPlaceholders).toEqual([
        kind === "resource_link" ? { kind, label: "doc", uri: "file:///doc" } : { kind },
      ])
    }
    agent.detach()
  })

  it("applies text, nesting, manual title and turn ordering", async () => {
    const { agent, emit, observations } = await open()
    await emit({
      sessionUpdate: "user_message_chunk",
      messageId: "user",
      content: { type: "text", text: "question" },
    })
    await emit({
      sessionUpdate: "agent_thought_chunk",
      messageId: "thought",
      content: { type: "text", text: "reasoning" },
    })
    const answer = {
      sessionUpdate: "agent_message_chunk",
      messageId: "answer",
      content: { type: "text", text: "response" },
    }
    await emit(answer)
    expect(flatMessageTexts(agent.bubbles)).toEqual(["question", "reasoning", "response"])
    expect(observations.find((entry) => entry.update === answer)?.turn).toBe("thinking")
    expect(agent.turnState).toBe("responding")
    expect(agent.bubbles.map((b) => b.messageId)).toEqual(["user", "thought", "answer"])
    await emit({
      sessionUpdate: "agent_message_chunk",
      messageId: "attachment",
      content: { type: "resource_link", uri: "file:///answer" },
    })
    const last = agent.bubbles.at(-1)
    expect(last?.kind === "message" && last.contentPlaceholders).toEqual([
      { kind: "resource_link", label: "file:///answer", uri: "file:///answer" },
    ])
    await emit({
      sessionUpdate: "tool_call",
      toolCallId: "parent",
      title: "Task",
      status: "pending",
    })
    await emit({
      sessionUpdate: "tool_call_update",
      toolCallId: "child",
      title: "Read",
      status: "in_progress",
      _meta: { claudeCode: { parentToolUseId: "parent" } },
    })
    await emit({
      sessionUpdate: "tool_call_update",
      toolCallId: "child",
      status: "completed",
      rawOutput: "done",
    })
    const parent = agent.bubbles.find(
      (b) => b.kind === "tool" && b.toolCall.toolCallId === "parent",
    )
    expect(
      parent?.kind === "tool" &&
        parent.subFrames?.map(
          (b) => b.kind === "tool" && [b.toolCall.toolCallId, b.toolCall.status, b.toolCall.result],
        ),
    ).toEqual([["child", "completed", "done"]])
    expect(agent.bubbles.filter((b) => b.kind === "tool")).toHaveLength(1)
    await emit({ sessionUpdate: "session_info_update", title: "automatic" })
    expect(agent.sessionTitle).toBe("automatic")
    agent.titleManual = true
    agent.sessionTitle = "manual"
    await emit({ sessionUpdate: "session_info_update", title: "replacement" })
    expect(agent.sessionTitle).toBe("manual")
    agent.detach()
  })
})

it("C1 WS observes nullish update and changes turn before agent-null throws", async () => {
  resetCaptured()
  const observations: unknown[] = []
  const agent = new AgentSession({ _onUpdateObserved: (u) => observations.push(u) })
  await agent.attach({ cwd: "/proj", cliKind: "claude" })
  expect(() => capturedOnUpdate?.({ update: null } as unknown as SessionNotification)).toThrow(
    TypeError,
  )
  expect(observations).toContain(null)
  const update = { sessionUpdate: "agent_message_chunk", content: null }
  expect(() => capturedOnUpdate?.({ update } as unknown as SessionNotification)).toThrow(TypeError)
  expect(agent.turnState).toBe("responding")
  expect(observations).toContain(update)
  agent.detach()
})

it("C2 HTTP reset/replay replaces previous transcript at the same session ID", async () => {
  const view = new HttpReplayView()
  view.connect("same-http-session")
  const observed: unknown[] = []
  const agent = new AgentSession({ view, _onUpdateObserved: (update) => observed.push(update) })
  agent._setStatusForTest("connected")
  view.applyIncoming({
    version: 1,
    updates: [
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "old",
        content: { type: "text", text: "http-old" },
      },
    ],
  })
  await vi.waitFor(() => expect(flatMessageTexts(agent.bubbles)).toEqual(["http-old"]))
  const original = agent.bubbles
  view.resetTranscript()
  view.applyIncoming({
    version: 2,
    updates: [
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "fresh",
        content: { type: "text", text: "http-fresh" },
      },
    ],
  })
  await vi.waitFor(() => expect(flatMessageTexts(agent.bubbles)).toEqual(["http-fresh"]))
  expect(agent.bubbles).toBe(original)
  expect(view.state.sessionId).toBe("same-http-session")
  expect(observed).toHaveLength(2)
  agent.detach()
})
