// @vitest-environment jsdom
/**
 * SessionBudgetPopover — C1 gate: cost `{ amount }` without currency must render.
 * slice token-usage-persistence
 */
import { mount, tick, unmount } from "svelte"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Harness from "./SessionBudgetPopover.harness.svelte"

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

describe("SessionBudgetPopover cost (C1)", () => {
  it("renders without throw when cost has amount but no currency", async () => {
    target = document.createElement("div")
    document.body.appendChild(target)
    expect(() => {
      app = mount(Harness, { target })
    }).not.toThrow()
    await tick()
    expect(target.textContent).toMatch(/0\.10|0\.1/)
  })
})
