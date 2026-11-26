import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Settings } from "./settings.svelte"
import { STORAGE_KEY } from "./settings-persistence"

let storage: Map<string, string>

beforeEach(() => {
  storage = new Map()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe("Settings agentListView", () => {
  it.each([{}, { agentListView: "unknown" }])("keeps width-dependent defaults for %j", (entry) => {
    storage.set(STORAGE_KEY, JSON.stringify(entry))
    const settings = new Settings()
    expect(settings.agentListView).toBeUndefined()
    expect(settings.getAgentListView(false)).toBe("tree")
    expect(settings.getAgentListView(true)).toBe("flat")
  })

  it.each(["tree", "flat"] as const)("persists %s across widths and reload", (view) => {
    const settings = new Settings()
    settings.setAgentListView(view)
    expect(settings.getAgentListView(false)).toBe(view)
    expect(settings.getAgentListView(true)).toBe(view)

    const raw = storage.get(STORAGE_KEY)
    expect(JSON.parse(raw ?? "{}")).toMatchObject({ agentListView: view })
    const reloaded = new Settings()
    expect(reloaded.getAgentListView(false)).toBe(view)
    expect(reloaded.getAgentListView(true)).toBe(view)
  })
})
