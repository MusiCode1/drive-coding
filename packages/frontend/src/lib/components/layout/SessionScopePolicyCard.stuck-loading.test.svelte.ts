// @vitest-environment jsdom
/**
 * SessionScopePolicyCard — retry visible while loading without confirmed (C3 gate).
 */
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Harness from "./SessionScopePolicyCard.stuck-loading.harness.svelte"

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

let target: HTMLDivElement | null = null
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
  vi.unstubAllGlobals()
  installLocalStorage()
})

afterEach(() => {
  if (app !== null) unmount(app)
  target?.remove()
  target = null
  app = null
})

describe("SessionScopePolicyCard stuck loading (C3)", () => {
  it("renders retry button when loading and not confirmed", async () => {
    target = document.createElement("div")
    document.body.appendChild(target)
    app = mount(Harness, { target })
    await tick()
    expect(target.querySelectorAll("button").length).toBe(1)
  })
})
