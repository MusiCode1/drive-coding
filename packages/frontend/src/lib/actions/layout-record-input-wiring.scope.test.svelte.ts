// @vitest-environment jsdom
import {
  createInitialSessionState,
  serializeFrame,
  snapshotFrame,
  snapshotPayload,
} from "@drive-coding/core/session"
import type { PendingCapture } from "@drive-coding/core/voice/pending-capture"
import { flushSync, mount, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFailedPromptStore } from "$lib/adapters/failed-prompt-store"
import { promptRecoveryDb } from "$lib/adapters/prompt-recovery-idb"
import { promptTestDb } from "$lib/components/chat/__tests__/type-area-harness.svelte"
import { promptPayload } from "$lib/engines/prompt-payload"
import { transcribe } from "$lib/adapters/voice/transcribe"
import { RecordCaptureCoordinator } from "$lib/engines/pending-capture-wiring"
import { createRemoteView } from "$lib/session/create-session-view"
import { _resetForTests, setBeUrlBase } from "$lib/util/be-url"
import { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { Mic } from "$lib/view-models/mic.svelte"
import Harness from "./layout-record-input-wiring-scope-harness.svelte"

type NavTarget = { url: URL }
type TestNavigation = {
  from: NavTarget
  to: NavTarget | null
  complete: Promise<void>
  willUnload: boolean
}
type Stored = { capture: PendingCapture; blob: Blob }

const fixture = vi.hoisted(() => ({
  before: (_nav: TestNavigation) => {},
  recorderStart: vi.fn(),
  recorderStop: vi.fn(),
  records: new Map<string | null, Stored>(),
  read: vi.fn<(owner: string | null, row: Stored | null) => Promise<Stored | null>>(),
  verify: vi.fn<(owner: string | null, matched: boolean) => Promise<boolean>>(),
  remove: vi.fn<(owner: string | null, id: string) => Promise<void>>(),
}))

const router = $state<{ path: string; to: NavTarget | null }>({ path: "/chat/fixture/A", to: null })
vi.mock("$app/state", () => ({
  page: {
    get route() {
      if (router.path === "/chat") return { id: "/chat" }
      const pieces = router.path.split("/")
      return { id: pieces[3] === "new" ? "/chat/[cliKind]/new" : "/chat/[cliKind]/[sessionId]" }
    },
    get params() {
      const [, , cliKind, sessionId] = router.path.split("/")
      return { cliKind, sessionId }
    },
  },
  navigating: {
    get to() {
      return router.to
    },
  },
}))
vi.mock("$lib/engines/recorder", () => ({
  Recorder: class {
    start = fixture.recorderStart
    stop = fixture.recorderStop
  },
}))
vi.mock("$lib/adapters/voice/transcribe", () => ({ transcribe: vi.fn() }))
vi.mock("$lib/adapters/agents-api", () => ({
  createAgent: vi.fn().mockResolvedValue({ agentId: "agent-fixture" }),
  deleteAgent: vi.fn().mockResolvedValue(undefined),
  notifySessionAttached: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("$lib/session/create-session-view", async (load) => ({
  ...(await load<typeof import("$lib/session/create-session-view")>()),
  createRemoteView: vi.fn(),
}))
vi.mock("$lib/adapters/record-capture-store", () => ({
  createRecordCaptureStore: () => ({
    forOwner: (key: string | null) => ({
      load: () => fixture.read(key, fixture.records.get(key) ?? null),
      matches: (id: string) => fixture.verify(key, fixture.records.get(key)?.capture.id === id),
      save: async (capture: PendingCapture, blob: Blob) => {
        fixture.records.set(key, { capture, blob })
      },
      updateMeta: async (id: string, patch: Partial<PendingCapture>) => {
        const item = fixture.records.get(key)
        if (item?.capture.id === id) {
          fixture.records.set(key, { ...item, capture: { ...item.capture, ...patch } })
        }
      },
      remove: (id: string) => fixture.remove(key, id),
    }),
  }),
}))

const base = "https://fixture.local/prefix"
const owner = (id = "A", cli = "fixture", backend = base) => JSON.stringify([backend, cli, id])
const transcript = { text: "fixture transcript", recordingId: "fixture-recording" }
const blob = new Blob(["fixture audio"], { type: "audio/webm" })
const seed = (id: string, cached = false): Stored => ({
  blob,
  capture: {
    id,
    source: "mic",
    mimeType: blob.type,
    recordingId: cached ? transcript.recordingId : "",
    createdAt: "2026-11-26T00:00:00Z",
    ...(cached ? { transcribedText: transcript.text } : { lastError: "mic.error.transcribe" }),
  },
})

const prompts: unknown[] = []
let app: { mic: Mic } | undefined
let session: AgentSession | undefined

async function startView(id = "A", cli = "fixture", backend = base) {
  const actual = await vi.importActual<typeof import("$lib/session/create-session-view")>(
    "$lib/session/create-session-view",
  )
  const tracked = createInitialSessionState({ sessionId: id })
  const connected = await actual.createRemoteView({
    agentId: "agent-fixture",
    baseUrl: backend,
    _fetch: async (url, init) => {
      if (url.includes("/events")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              const frame = snapshotFrame(tracked, undefined, "meta")
              controller.enqueue(new TextEncoder().encode(serializeFrame(frame)))
            },
          }),
        )
      }
      if (url.includes("/history")) {
        return Response.json(snapshotPayload(tracked, undefined, { history: "omit" }))
      }
      const body = JSON.parse(String(init?.body))
      if (body.method === "session/prompt") prompts.push(body.params)
      return Response.json({}, { status: 202 })
    },
  })
  vi.mocked(createRemoteView).mockResolvedValueOnce(connected)
  if (!session) throw new Error("missing test session")
  await session.attachRemote({ cwd: "/fixture", transport: "http", cliKind: cli })
  expect(session.status).toBe("connected")
}

async function open() {
  session = new AgentSession()
  app = mount(Harness, {
    target: document.body,
    props: {
      session,
      beforeNavigate: (hook) => {
        fixture.before = (nav) => hook(nav as Parameters<typeof hook>[0])
      },
    },
  })
  await startView()
  flushSync()
  return { ...app, session }
}

function navigation(path: string | null, willUnload = false) {
  const complete = Promise.withResolvers<void>()
  const to = path === null ? null : { url: new URL(path, base) }
  const from = { url: new URL(router.path, base) }
  fixture.before({ from, to, complete: complete.promise, willUnload })
  router.to = to
  return {
    commit() {
      if (path) router.path = new URL(path, base).pathname
      router.to = null
      complete.resolve()
    },
    reject() {
      complete.reject(new Error("navigation cancelled or superseded"))
    },
  }
}

async function switchSession(active: AgentSession, id: string) {
  await active.switchSession({ sessionId: id, cliKind: "fixture", cwd: "/fixture" })
  expect(active.sessionId).toBe(id)
}

async function recordFailure(mic: NonNullable<typeof app>["mic"]) {
  vi.mocked(transcribe).mockRejectedValueOnce(new Error("synthetic STT failure"))
  await mic.toggle()
  await mic.toggle()
  expect(mic.error).toBe("mic.error.transcribe")
  expect(mic.canRetry).toBe(true)
}

beforeEach(() => {
  vi.spyOn(promptRecoveryDb, "transact").mockImplementation(promptTestDb().transact)
  prompts.length = 0
  fixture.records.clear()
  router.path = "/chat/fixture/A"
  router.to = null
  fixture.read.mockReset().mockImplementation(async (_owner, row) => row)
  fixture.verify.mockReset().mockImplementation(async (_owner, matched) => matched)
  fixture.remove.mockReset().mockImplementation(async (key, id) => {
    if (fixture.records.get(key)?.capture.id === id) fixture.records.delete(key)
  })
  fixture.recorderStart.mockReset().mockResolvedValue(undefined)
  fixture.recorderStop.mockReset().mockResolvedValue({ blob, mimeType: blob.type })
  vi.mocked(transcribe).mockReset()
  setBeUrlBase(base)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  if (app) await unmount(app)
  app = undefined
  session?.detach()
  session = undefined
  _resetForTests()
  vi.restoreAllMocks()
})

describe("Record entry and pending capture ownership", () => {
  it("keeps two failed captures separate and restores A under a different agent", async () => {
    const { mic, session } = await open()
    await recordFailure(mic)
    const a = fixture.records.get(owner())
    navigation("/chat/fixture/B").commit()
    await switchSession(session, "B")
    expect(mic.canRetry).toBe(false)
    await recordFailure(mic)
    expect(fixture.records.get(owner("B"))).not.toEqual(a)
    expect(prompts).toEqual([])

    session.agentId = "replacement-agent"
    navigation("/chat/fixture/A").commit()
    await switchSession(session, "A")
    await vi.waitFor(() => expect(mic.pendingRestored).toBe(true))
    expect(fixture.records.get(owner())).toEqual(a)
  })

  it.each([false, true])(
    "keeps the original owner through permission and stop (reject: %s)",
    async (reject) => {
      const { mic, session } = await open()
      const permission = Promise.withResolvers<void>()
      fixture.recorderStart.mockReturnValueOnce(permission.promise)
      const starting = mic.toggle()
      navigation("/chat/fixture/B").commit()
      await switchSession(session, "B")
      if (reject) {
        permission.reject(new DOMException("no device", "NotFoundError"))
        await starting
      } else {
        permission.resolve()
        await starting
        vi.mocked(transcribe).mockRejectedValueOnce(new Error("offline"))
        await mic.toggle()
        expect(fixture.records.get(owner())?.capture.lastError).toBe("mic.error.transcribe")
      }
      expect(mic.error).toBeNull()
      expect(mic.canRetry).toBe(false)
      expect(prompts).toEqual([])
    },
  )

  it("caches old-generation STT on A→B→A, then sends once in A with the original recording ID", async () => {
    const { mic, session } = await open()
    await recordFailure(mic)
    const handlers = mic.bindPendingActions()
    const stt = Promise.withResolvers<typeof transcript>()
    vi.mocked(transcribe).mockReturnValueOnce(stt.promise)
    const retry = handlers.onRetry()
    expect(handlers.onRetry()).toBeUndefined()
    navigation("/chat/fixture/B").commit()
    await switchSession(session, "B")
    expect(handlers.onRetry()).toBeUndefined()
    expect(handlers.onDismiss()).toBeUndefined()
    navigation("/chat/fixture/A").commit()
    await switchSession(session, "A")
    expect(handlers.onDismiss()).toBeUndefined()
    stt.resolve(transcript)
    await retry
    expect(prompts).toEqual([])
    expect(fixture.remove).not.toHaveBeenCalled()
    expect(fixture.records.get(owner())?.capture).toMatchObject({
      transcribedText: transcript.text,
    })
    await vi.waitFor(() => expect(mic.canRetry).toBe(true))
    await mic.bindPendingActions().onRetry()
    await vi.waitFor(() =>
      expect(prompts).toEqual([
        {
          sessionId: "A",
          content: [{ type: "text", text: transcript.text }],
          meta: { recordingId: transcript.recordingId },
        },
      ]),
    )
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])(
    "blocks old handoffs while a superseding navigation is live (first same route: %s)",
    async (sameRoute) => {
      const { mic } = await open()
      await recordFailure(mic)
      const handlers = mic.bindPendingActions()
      const stt = Promise.withResolvers<typeof transcript>()
      vi.mocked(transcribe).mockReturnValueOnce(stt.promise)
      const retry = handlers.onRetry()
      const first = navigation(sameRoute ? "/chat/fixture/A?query=1" : "/chat/fixture/B")
      router.to = { url: new URL("/chat/fixture/C", base) }
      first.reject()
      await Promise.resolve()
      stt.resolve(transcript)
      await retry
      expect(mic.canRetry).toBe(false)
      expect(handlers.onRetry()).toBeUndefined()
      expect(handlers.onDismiss()).toBeUndefined()
      expect(prompts).toEqual([])
      expect(fixture.remove).not.toHaveBeenCalled()
      router.to = null
      await vi.waitFor(() => expect(mic.canRetry).toBe(true))
      expect(handlers.onRetry()).toBeUndefined()
      expect(handlers.onDismiss()).toBeUndefined()
      await mic.bindPendingActions().onRetry()
      await vi.waitFor(() => expect(prompts).toHaveLength(1))
    },
  )

  it("cancel reopens a compatible entry, and a mismatched chat URL stays blocked", async () => {
    const { mic } = await open()
    await recordFailure(mic)
    const old = mic.bindPendingActions()
    const cancelled = navigation("/chat/fixture/B")
    router.to = null
    cancelled.reject()
    await vi.waitFor(() => expect(mic.canRetry).toBe(true))
    expect(old.onDismiss()).toBeUndefined()
    navigation("/chat/fixture/B").commit()
    await Promise.resolve()
    expect(mic.canRetry).toBe(false)
    expect(prompts).toEqual([])
  })

  it("holds a leave with pending permission through route cancellation", async () => {
    const { mic, session } = await open()
    await recordFailure(mic)
    const old = mic.bindPendingActions()
    const resolve = vi.fn()
    session.pendingPermission = {
      params: { sessionId: "A", toolCall: { toolCallId: "fixture-tool" }, options: [] },
      resolve,
    }
    const leave = navigation("/")
    session.notifySessionNavigatedAway()
    router.to = null
    leave.reject()
    await Promise.resolve()
    expect(resolve).toHaveBeenCalledWith({ outcome: { outcome: "cancelled" } })
    expect(session.sessionId).toBe("A")
    expect(mic.canRetry).toBe(false)
    expect(old.onDismiss()).toBeUndefined()
    expect(fixture.remove).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "ignores a fresh verification of X completed after dismiss (cached: %s)",
    async (cached) => {
      if (cached) fixture.records.set(owner(), seed("x", true))
      const { mic } = await open()
      if (!cached) await recordFailure(mic)
      await vi.waitFor(() => expect(mic.canRetry).toBe(true))
      const checked = Promise.withResolvers<boolean>()
      fixture.verify.mockReturnValueOnce(checked.promise)
      vi.mocked(transcribe).mockResolvedValueOnce(transcript)
      const handlers = mic.bindPendingActions()
      const retry = handlers.onRetry()
      await vi.waitFor(() => expect(fixture.verify).toHaveBeenCalledOnce())
      checked.resolve(true)
      await handlers.onDismiss()
      await retry
      expect(fixture.remove).toHaveBeenCalledOnce()
      expect(prompts).toEqual([])
      expect(fixture.records.get(owner())).toBeUndefined()
      expect(mic.state).toBe("idle")
      expect(transcribe).toHaveBeenCalledTimes(cached ? 0 : 2)
    },
  )

  it("removes a restored Record with an existing receipt without STT or RPC", async () => {
    fixture.records.set(owner(), seed("delivered", true))
    const store = createFailedPromptStore(promptRecoveryDb)
    const claimed = await store.adopt(owner(), promptPayload(transcript.text, [], ""), {
      recordCaptureId: "delivered",
    })
    if (claimed.kind !== "claimed") throw new Error("Missing fixture claim")
    await store.settle(claimed.record, { delivery: "accepted" })
    const { mic } = await open()
    await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalledWith(owner(), "delivered"))
    expect(mic.canRetry).toBe(false)
    expect(transcribe).not.toHaveBeenCalled()
    expect(prompts).toEqual([])
    expect(await store.hasRecordReceipt(owner(), "delivered")).toBe(true)
  })

  it("blocks an old Record that passed matches after another tab already accepted it", async () => {
    fixture.records.set(owner(), seed("checked-before-claim", true))
    const { mic } = await open()
    await vi.waitFor(() => expect(mic.canRetry).toBe(true))
    const match = Promise.withResolvers<boolean>()
    fixture.verify.mockReturnValueOnce(match.promise)
    const retry = mic.bindPendingActions().onRetry()
    await vi.waitFor(() => expect(fixture.verify).toHaveBeenCalledWith(owner(), true))
    const otherTab = createFailedPromptStore(promptRecoveryDb)
    const adopted = await otherTab.adopt(
      owner(),
      promptPayload(transcript.text, [], transcript.recordingId),
      {
        recordCaptureId: "checked-before-claim",
      },
    )
    if (adopted.kind !== "claimed") throw new Error("Missing other-tab claim")
    await otherTab.settle(adopted.record, { delivery: "accepted" })
    match.resolve(true)
    await retry
    expect(prompts).toEqual([])
    expect(transcribe).not.toHaveBeenCalled()
    expect(fixture.remove).toHaveBeenCalledWith(owner(), "checked-before-claim")
    expect(await otherTab.hasRecordReceipt(owner(), "checked-before-claim")).toBe(true)
  })

  it("rejects stale hydration after a new save supersedes the disk read", async () => {
    fixture.records.set(owner(), seed("old", true))
    const loaded = Promise.withResolvers<Stored>()
    fixture.read.mockReturnValueOnce(loaded.promise)
    const { mic } = await open()
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalled())
    await recordFailure(mic)
    const saved = fixture.records.get(owner())
    loaded.resolve(seed("old", true))
    await Promise.resolve()
    await Promise.resolve()
    expect(mic.error).toBe("mic.error.transcribe")
    expect(fixture.records.get(owner())).toEqual(saved)
    expect(prompts).toEqual([])
  })

  it("rejects hydration pending across dismiss and prevents the removed capture from returning", async () => {
    const { mic } = await open()
    await recordFailure(mic)
    const stored = fixture.records.get(owner())
    expect(stored).toBeDefined()
    const loaded = Promise.withResolvers<Stored | null>()
    fixture.read.mockReturnValueOnce(loaded.promise)
    navigation("/chat/fixture/A?query=2").commit()
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(2))
    await mic.bindPendingActions().onDismiss()
    loaded.resolve(stored ?? null)
    await Promise.resolve()
    await Promise.resolve()
    expect(mic.canRetry).toBe(false)
    expect(mic.error).toBeNull()
    expect(fixture.records.has(owner())).toBe(false)
  })

  it("keeps B active when a delayed hydrate from A resolves", async () => {
    const loaded = Promise.withResolvers<Stored>()
    fixture.read.mockReturnValueOnce(loaded.promise)
    const { mic, session } = await open()
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledWith(owner(), null))
    navigation("/chat/fixture/B").commit()
    await switchSession(session, "B")
    loaded.resolve(seed("old", true))
    await Promise.resolve()
    await Promise.resolve()
    expect(mic.canRetry).toBe(false)
    expect(prompts).toEqual([])
  })

  it("preserves a same-owner replacement after X had already passed the disk read", async () => {
    fixture.records.set(owner(), seed("x", true))
    const coordinator = new RecordCaptureCoordinator(() => {})
    await coordinator.hydrate(owner(), () => true)
    const previous = coordinator.get(owner())
    if (!previous) throw new Error("missing seeded record")
    const checked = Promise.withResolvers<boolean>()
    fixture.verify.mockReturnValueOnce(checked.promise)
    const onSend = vi.fn(() => true)
    const retry = coordinator.retry(previous, { onSend, transcribe, canTranscribe: () => true })
    await vi.waitFor(() => expect(fixture.verify).toHaveBeenCalledWith(owner(), true))
    checked.resolve(true)
    await coordinator.process(owner(), new Blob(["replacement"]), "audio/webm", null)
    await retry
    const replacement = fixture.records.get(owner())
    expect(replacement?.capture.id).not.toBe("x")
    expect(await replacement?.blob.text()).toBe("replacement")
    expect(onSend).not.toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
    expect(fixture.remove).not.toHaveBeenCalled()
  })

  it.each([
    ["other-cli", base],
    ["fixture", "https://other-be.local/prefix"],
  ])(
    "isolates identical session IDs when CLI or backend differ (%s / %s)",
    async (cli, backend) => {
      const { mic, session } = await open()
      await recordFailure(mic)
      const old = mic.bindPendingActions()
      session.detach()
      router.path = "/chat"
      await startView("A", cli, backend)
      await vi.waitFor(() =>
        expect(fixture.read).toHaveBeenCalledWith(owner("A", cli, backend), null),
      )
      expect(mic.canRetry).toBe(false)
      expect(old.onRetry()).toBeUndefined()
      expect(old.onDismiss()).toBeUndefined()
      expect(prompts).toEqual([])
    },
  )
})
