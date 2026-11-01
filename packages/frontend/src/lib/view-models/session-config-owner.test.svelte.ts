import { describe, expect, it } from "vitest"
import { SessionConfigOwner } from "./session-config-owner.svelte"

describe("SessionConfigOwner", () => {
  it("capture replaces all three fields with defaults for missing keys", () => {
    const owner = new SessionConfigOwner()
    owner.configOptions = [
      { id: "a", name: "A", type: "boolean", currentValue: true, category: null },
    ]
    owner.models = { currentModelId: "m1", availableModels: [] }
    owner.modes = { currentModeId: "d", availableModes: [] }

    owner.capture({})

    expect(owner.configOptions).toEqual([])
    expect(owner.models).toBeNull()
    expect(owner.modes).toBeNull()
  })

  it("syncFromHttpView replaces modes and configOptions without touching models", () => {
    const owner = new SessionConfigOwner()
    owner.models = { currentModelId: "keep", availableModels: [{ modelId: "keep", name: "Keep" }] }
    owner.modes = { currentModeId: "old", availableModes: [] }
    owner.configOptions = []

    owner.syncFromHttpView({
      modes: { currentModeId: "new", availableModes: [{ id: "new", name: "New" }] },
      configOptions: [
        { id: "opt", name: "Opt", type: "boolean", currentValue: false, category: null },
      ],
    })

    expect(owner.models?.currentModelId).toBe("keep")
    expect(owner.modes?.currentModeId).toBe("new")
    expect(owner.configOptions).toHaveLength(1)
  })
})
