// @vitest-environment jsdom
/**
 * type-area-dictate-send.test.ts — Send during listening + busy spinner gates.
 *
 * ─── slice dictate-to-input-polish (C1) ───
 */
import { flushSync, mount, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDictateSubmitSourceDb } from "$lib/adapters/dictate-submit-source"
import { createFailedPromptStore } from "$lib/adapters/failed-prompt-store"
import type { RecordTarget } from "$lib/engines/pending-capture-wiring"
import { promptOwner } from "$lib/engines/prompt-payload"
import type { SessionView } from "$lib/session/session-view"
import { DictateSubmit } from "$lib/view-models/dictate-submit.svelte"
import { PromptRetry } from "$lib/view-models/prompt-retry.svelte"
import type { AgentSession } from "$lib/view-models/agent-session.svelte"
import type { FinishListeningResult } from "$lib/view-models/dictate.svelte"
import TypeAreaHarness, { promptTestDb } from "./type-area-harness.svelte"

const recorder = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock("$lib/engines/recorder", () => ({
  Recorder: class {
    start = recorder.start
    stop = recorder.stop
  },
}))
vi.mock("$lib/engines/image-attachment", () => ({
  fileToImageAttachment: async () => ({
    id: "fixture-attachment", mimeType: "image/png", dataBase64: "QUJD", previewUrl: "blob:fixture", bytes: 3,
  }),
  revokeAttachment: () => {},
}))

let target: HTMLDivElement | null = null
let app: object | null = null

let ownedVm: PromptRetry | undefined

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">)
})

afterEach(async () => {
  if (app !== null) await unmount(app)
  ownedVm?.dispose()
  ownedVm = undefined
  vi.unstubAllGlobals()
  target?.remove()
  target = null
  app = null
})

function mountHarness(props: {
  enterToSend?: boolean
  supportsImageInput?: boolean
  owned?: { prompts: PromptRetry; dictateSubmit: DictateSubmit }
  dictateState?: "idle" | "listening" | "busy"
  finishListening?: () => Promise<FinishListeningResult>
  sendPrompt?: (text: string, opts?: { attachments?: unknown[] }) => void
  session?: { status: AgentSession["status"] }
} = {}): HTMLFormElement {
  target = document.createElement("div")
  document.body.appendChild(target)
  app = mount(TypeAreaHarness, {
    target,
    props: {
      enterToSend: props.enterToSend ?? false,
      supportsImageInput: props.supportsImageInput,
      owned: props.owned,
      dictateState: props.dictateState,
      finishListening: props.finishListening,
      sendPrompt: props.sendPrompt ?? (() => {}),
      session: props.session,
    },
  })
  const form = target.querySelector("form")
  if (!(form instanceof HTMLFormElement)) {
    throw new Error("TypeArea form not found")
  }
  return form
}

function getSubmitButton(form: HTMLFormElement): HTMLButtonElement {
  const btn = form.querySelector('button[type="submit"]')
  if (!(btn instanceof HTMLButtonElement)) {
    throw new Error("submit button not found")
  }
  return btn
}

function getTextarea(): HTMLTextAreaElement {
  const textarea = target?.querySelector("textarea")
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("textarea not found")
  }
  return textarea
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("TypeArea — send during listening (dictate-to-input-polish)", () => {
  it("listening + empty draft + voice stub sends directly without showing voice in textarea", async () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn(async () => ({ ok: true, text: "voice" } as const))
    const form = mountHarness({ dictateState: "listening", finishListening, sendPrompt })

    const textarea = getTextarea()
    expect(textarea.value).toBe("")

    getSubmitButton(form).click()
    expect(textarea.value).not.toContain("voice")

    await flushMicrotasks()

    expect(finishListening).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith("voice", { attachments: [] })
    expect(textarea.value).toBe("")
  })

  it("listening + typed text + voice stub sends combined body", async () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn(async () => ({ ok: true, text: "voice" } as const))
    mountHarness({ dictateState: "listening", finishListening, sendPrompt })

    const textarea = getTextarea()
    textarea.value = "typed"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    getSubmitButton(document.querySelector("form") as HTMLFormElement).click()
    await flushMicrotasks()

    expect(sendPrompt).toHaveBeenCalledWith("typed voice", { attachments: [] })
  })

  it("typing during finishListening await is included in sent body", async () => {
    const sendPrompt = vi.fn()
    let resolveFinish!: (value: FinishListeningResult) => void
    const finishListening = vi.fn(
      () =>
        new Promise<FinishListeningResult>((resolve) => {
          resolveFinish = resolve
        }),
    )
    mountHarness({ dictateState: "listening", finishListening, sendPrompt })

    getSubmitButton(document.querySelector("form") as HTMLFormElement).click()

    const textarea = getTextarea()
    textarea.value = "during"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    resolveFinish({ ok: true, text: "voice" })
    await flushMicrotasks()

    expect(sendPrompt).toHaveBeenCalledWith("during voice", { attachments: [] })
  })

  it("disconnect after finishListening await skips sendPrompt and clear", async () => {
    const sendPrompt = vi.fn()
    const session: { status: AgentSession["status"] } = { status: "connected" }
    const finishListening = vi.fn(async () => {
      session.status = "disconnected"
      return { ok: true, text: "voice" } as const
    })
    mountHarness({ dictateState: "listening", finishListening, sendPrompt, session })

    const textarea = getTextarea()
    textarea.value = "keep me"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    getSubmitButton(document.querySelector("form") as HTMLFormElement).click()
    await flushMicrotasks()

    expect(sendPrompt).not.toHaveBeenCalled()
    expect(textarea.value).toBe("keep me")
  })

  it("submit disabled when busy even with text", () => {
    const form = mountHarness({ dictateState: "busy" })
    const textarea = getTextarea()
    textarea.value = "hello"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    expect(getSubmitButton(form).disabled).toBe(true)
  })

  it("submit disabled when idle and empty", () => {
    const form = mountHarness({ dictateState: "idle" })
    expect(getSubmitButton(form).disabled).toBe(true)
  })

  it("Enter with enterToSend during listening triggers send", async () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn(async () => ({ ok: true, text: "voice" } as const))
    mountHarness({ dictateState: "listening", enterToSend: true, finishListening, sendPrompt })

    const textarea = getTextarea()
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    )
    await flushMicrotasks()

    expect(finishListening).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith("voice", { attachments: [] })
  })
})

describe("TypeArea — idle typed send remains synchronous until first await", () => {
  it("idle + text sends on Enter without finishListening", () => {
    const sendPrompt = vi.fn()
    const finishListening = vi.fn()
    mountHarness({ dictateState: "idle", enterToSend: true, finishListening, sendPrompt })

    const textarea = getTextarea()
    textarea.value = "hello"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    )

    expect(finishListening).not.toHaveBeenCalled()
    expect(sendPrompt).toHaveBeenCalledOnce()
    expect(sendPrompt).toHaveBeenCalledWith("hello", { attachments: [] })
  })
})

describe("owned Dictate Submit through the TypeArea and Prompt DB", () => {
  it.each([
    { text: "", image: false, move: false },
    { text: "   ", image: true, move: false },
    { text: "", image: true, move: true },
    { text: "   ", image: false, move: true },
  ])("preserves a real payload with an empty STT result ($text/$image/$move)", async ({ text, image, move }) => {
    const db = promptTestDb()
    const store = createFailedPromptStore(db)
    const sourceDb = createDictateSubmitSourceDb(db)
    const base = "https://fixture.local"
    const transport = vi.fn().mockResolvedValue({ kind: "accepted" })
    const view = { promptTo: transport } as unknown as SessionView
    const forSession = (id: string, generation: number): RecordTarget => ({
      view, generation, agentId: `agent-${generation}`, backendBaseUrl: base,
      ownerKey: promptOwner(base, "fixture", id),
    })
    const a = forSession("A", 1)
    const b = forSession("B", 2)
    let active = a
    const targets = { current: () => active, isCurrent: (entry: RecordTarget) => entry === active }
    const prompts = new PromptRetry(targets, vi.fn(), store)
    ownedVm = prompts
    const stt = Promise.withResolvers<{ text: string; recordingId: string }>()
    const speech = vi.fn(() => stt.promise)
    const dictateSubmit = new DictateSubmit(prompts, sourceDb, speech)
    recorder.start.mockReset().mockResolvedValue(undefined)
    recorder.stop.mockReset().mockResolvedValue({
      blob: new Blob(["fixture audio"], { type: "audio/webm" }), mimeType: "audio/webm",
    })
    const form = mountHarness({ owned: { prompts, dictateSubmit }, supportsImageInput: image })
    const mic = form.querySelector<HTMLButtonElement>('button[aria-label="dictate.start"]')
    if (!mic) throw new Error("Missing Dictate button")
    const setText = (value: string) => {
      const textarea = getTextarea()
      textarea.value = value
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      flushSync()
    }
    if (image) {
      const file = form.querySelector('input[type="file"]')
      if (!file) throw new Error("Missing image input")
      Object.defineProperty(file, "files", { value: [new File(["abc"], "fixture.png", { type: "image/png" })] })
      file.dispatchEvent(new Event("change", { bubbles: true }))
      await vi.waitFor(() => expect(target?.querySelector("img")).not.toBeNull())
    } else {
      setText("typed A")
    }
    mic.click()
    await vi.waitFor(() => expect(mic.getAttribute("aria-pressed")).toBe("true"))
    getSubmitButton(form).click()
    await vi.waitFor(() => expect(speech).toHaveBeenCalledOnce())
    const persisted = await sourceDb.load(a.ownerKey)
    expect(persisted?.snapshot.text).toBe(image ? "" : "typed A")
    expect(persisted?.snapshot.attachments).toHaveLength(image ? 1 : 0)
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(transport).not.toHaveBeenCalled()

    if (move) {
      active = b
      setText("typed B")
    } else if (!image) {
      setText("updated A")
    }
    stt.resolve({ text, recordingId: "irrelevant-dictate-id" })
    if (move) {
      await vi.waitFor(async () =>
        expect((await sourceDb.load(a.ownerKey))?.capture.transcribedText).toBe(text))
      expect(transport).not.toHaveBeenCalled()
      expect(getTextarea().value).toBe("typed B")
      expect(await sourceDb.load(b.ownerKey)).toBeUndefined()
      active = forSession("A", 3)
      const reopened = new DictateSubmit(prompts, createDictateSubmitSourceDb(db), speech)
      await reopened.refresh()
      const captured = reopened.source
      if (!captured) throw new Error("Missing restored Dictate source")
      await reopened.resume(captured)
    }
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    expect(transport).toHaveBeenCalledWith("A", image
      ? [{ type: "image", mimeType: "image/png", data: "QUJD" }]
      : [{ type: "text", text: move ? "typed A" : "updated A" }], undefined)
    expect(speech).toHaveBeenCalledOnce()
    expect(await sourceDb.load(a.ownerKey)).toBeUndefined()
    if (!move) expect(getTextarea().value).toBe("")
  })
})
