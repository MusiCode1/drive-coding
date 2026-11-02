import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { describe, expect, it, vi } from "vitest"
import { SessionCapabilitiesOwner } from "./session-capabilities-owner"

function makeCaps(overrides: Partial<NormalizedCapabilities> = {}): NormalizedCapabilities {
  return {
    mcp: false,
    compact: false,
    commands: false,
    usage: false,
    configOptions: false,
    rename: false,
    thinkingTokens: false,
    image: false,
    systemPrompt: "unsupported",
    ...overrides,
  }
}

describe("SessionCapabilitiesOwner", () => {
  it("starts with null capabilities and all-false supports", () => {
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent: vi.fn() }))
    expect(owner.capabilities).toBeNull()
    expect(owner.supports.thinkingTokens).toBe(false)
    expect(owner.supports.systemPrompt).toBe("unsupported")
    expect(owner.showsSystemPromptWarning).toBe(false)
  })

  it("setCapabilities replaces the snapshot", () => {
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent: vi.fn() }))
    owner.setCapabilities(makeCaps({ usage: true, systemPrompt: "native" }))
    expect(owner.capabilities?.usage).toBe(true)
    expect(owner.supports.usage).toBe(true)
    expect(owner.showsSystemPromptWarning).toBe(false)
  })

  it("syncFromHttpView(null) does not clobber an existing value", () => {
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent: vi.fn() }))
    owner.setCapabilities(makeCaps({ image: true }))
    owner.syncFromHttpView(null)
    expect(owner.capabilities?.image).toBe(true)
  })

  it("syncFromHttpView(non-null) replaces", () => {
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent: vi.fn() }))
    owner.setCapabilities(makeCaps({ image: true }))
    owner.syncFromHttpView(makeCaps({ image: false, usage: true }))
    expect(owner.capabilities?.image).toBe(false)
    expect(owner.capabilities?.usage).toBe(true)
  })

  it("reset clears capabilities and sdk message counter", () => {
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent: vi.fn() }))
    owner.setCapabilities(makeCaps({ usage: true }))
    owner.onExtNotification("_claude/sdkMessage", { type: "system" })
    expect(owner.claudeRawSdkMessageCount).toBe(1)
    owner.reset()
    expect(owner.capabilities).toBeNull()
    expect(owner.claudeRawSdkMessageCount).toBe(0)
  })

  it("onExtNotification increments counter for ignored sdk messages and skips sink", () => {
    const onSubagentEvent = vi.fn()
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent }))
    owner.onExtNotification("_claude/sdkMessage", { type: "system" })
    expect(owner.claudeRawSdkMessageCount).toBe(1)
    expect(onSubagentEvent).not.toHaveBeenCalled()
  })

  it("onExtNotification forwards non-ignored sdk messages to transcript sink", () => {
    const onSubagentEvent = vi.fn()
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent }))
    owner.onExtNotification("_claude/sdkMessage", {
      message: {
        type: "system",
        subtype: "task_started",
        task_id: "ad36e85f15e4a56a9",
        tool_use_id: "toolu_01GiSAsvUBjALq1WGBB2xQ1K",
      },
    })
    expect(onSubagentEvent).toHaveBeenCalledOnce()
  })

  it("onExtNotification stores _drive/capabilities payload as-is", () => {
    const owner = new SessionCapabilitiesOwner(() => ({ onSubagentEvent: vi.fn() }))
    const payload = makeCaps({ thinkingTokens: true, systemPrompt: "unsupported" })
    owner.onExtNotification("_drive/capabilities", payload as unknown as Record<string, unknown>)
    expect(owner.capabilities).toEqual(payload)
    expect(owner.showsSystemPromptWarning).toBe(true)
  })
})
