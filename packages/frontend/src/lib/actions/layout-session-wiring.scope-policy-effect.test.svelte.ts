// @vitest-environment jsdom
/**
 * layout-session-wiring — installSessionScopePolicy must not loop scope-policy fetches (C4).
 */
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../adapters/scope-policy-api.js", () => ({
  fetchScopePolicyForAgent: vi.fn(),
  patchScopePolicyForAgent: vi.fn(),
}))

import { fetchScopePolicyForAgent } from "../adapters/scope-policy-api.js"
import Harness from "./layout-session-wiring.scope-policy.harness.svelte"

const mockFetch = fetchScopePolicyForAgent as ReturnType<typeof vi.fn>

function installLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  })
}

const SNAP = {
  policies: { message: "ask", update: "ask", close: "ask" },
  sources: { message: "default", update: "default", close: "default" },
}

let target: HTMLDivElement | null = null
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
  vi.unstubAllGlobals()
  installLocalStorage()
  vi.resetAllMocks()
  mockFetch.mockResolvedValue(SNAP)
})

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

describe("installSessionScopePolicy effect loop (C4)", () => {
  it("issues one scope-policy fetch per attach, not a reactive loop", { timeout: 60_000 }, async () => {
    target = document.createElement("div")
    document.body.appendChild(target)
    app = mount(Harness, { target })
    await tick()
    expect(mockFetch.mock.calls.length).toBe(1)
  })
})
