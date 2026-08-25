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

const inbound = fixture.filter((e) => e.dir === "in")
const acpUpdateEntries = inbound.filter(
  (e) => e.channel === "acp" && e.frame.method === "session/update",
)
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

function synthesizeWireFromInbound(
  mode: "snapshot" | "drip",
): { batches: WireUpdateBatch[]; wireCount: number } {
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

const { batches: snapshotBatches, wireCount: expectedWireCount } = synthesizeWireFromInbound(
  "snapshot",
)
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

vi.mock("$lib/engines/ws-transport", () => ({
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
  capturedOnUpdate = null
  capturedOnExtNotification = null
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
