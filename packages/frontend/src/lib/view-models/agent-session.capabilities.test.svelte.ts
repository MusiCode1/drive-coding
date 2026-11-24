// @vitest-environment jsdom

import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { flushSync } from "svelte"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { hostSessionView } from "./__fixtures__/host-session-view"
import { AgentSession } from "./agent-session.svelte"

function makeCapabilities(overrides: Partial<NormalizedCapabilities> = {}): NormalizedCapabilities {
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

describe("AgentSession capabilities from the host", () => {
  let session: AgentSession
  let host: ReturnType<typeof hostSessionView>

  beforeEach(async () => {
    host = hostSessionView()
    await host.view.connect()
    session = new AgentSession({ view: host.view })
  })

  afterEach(() => host.view.close())

  async function simulateCaps(caps: Partial<NormalizedCapabilities>): Promise<void> {
    host.send({
      sessionUpdate: "_drive/session_update",
      changes: { capabilities: makeCapabilities(caps) },
    })
    await host.settle()
  }

  it("vm.capabilities is null before attach", () => {
    expect(session.capabilities).toBeNull()
  })

  it("vm.supports returns all-false before attach", () => {
    const s = session.supports
    expect(s.thinkingTokens).toBe(false)
    expect(s.mcp).toBe(false)
    expect(s.configOptions).toBe(false)
  })

  it("vm.capabilities is loaded from the host after attach", async () => {
    await simulateCaps({ thinkingTokens: true, mcp: false })

    expect(session.capabilities).not.toBeNull()
    expect(session.capabilities?.thinkingTokens).toBe(true)
  })

  it("vm.supports.thinkingTokens is true after the host sends thinkingTokens:true", async () => {
    await simulateCaps({ thinkingTokens: true })

    expect(session.supports.thinkingTokens).toBe(true)
  })

  it("vm.supports.thinkingTokens is false after the host sends thinkingTokens:false", async () => {
    await simulateCaps({ thinkingTokens: false })

    expect(session.supports.thinkingTokens).toBe(false)
  })

  // slice codex-voice-poc: consumers that react to capabilities (the built-in Live voice) never
  // saw them arrive — the field was not $state, so an effect read null once and never re-ran.
  it("capabilities are reactive: an effect re-runs when they arrive", async () => {
    const seen: (boolean | undefined)[] = []
    const dispose = $effect.root(() => {
      $effect(() => {
        seen.push(session.capabilities?.voice)
      })
    })
    flushSync()
    await simulateCaps({ voice: true })
    flushSync()
    expect(host.view.state.capabilities).toMatchObject({ voice: true })
    expect(session.capabilities?.voice).toBe(true)
    dispose()
    expect(seen.at(-1)).toBe(true)
  })

  it("detach clears #capabilities → vm.capabilities == null", async () => {
    await simulateCaps({ thinkingTokens: true })
    expect(session.capabilities).not.toBeNull()

    session.detach()

    expect(session.capabilities).toBeNull()
  })

  // ─── slice reattach-state-sync: supportsImageInput from normalized caps ───
  it("supportsImageInput becomes true when normalized capabilities arrive", async () => {
    expect(session.supportsImageInput).toBe(false)

    await simulateCaps({ image: true })

    expect(session.supportsImageInput).toBe(true)
  })

  it("supportsImageInput stays false when normalized image is false", async () => {
    await simulateCaps({ image: false })

    expect(session.supportsImageInput).toBe(false)
  })

  it("counts _claude/sdkMessage ext notifications for the raw SDK spike", async () => {
    expect(session.claudeRawSdkMessageCount).toBe(0)

    host.send({
      sessionUpdate: "_drive/ext_notification",
      method: "_claude/sdkMessage",
      params: {
        message: { type: "system", subtype: "task_started" },
      },
    })
    host.send({
      sessionUpdate: "_drive/ext_notification",
      method: "_claude/sdkMessage",
      params: {
        message: { type: "assistant", parent_tool_use_id: "toolu_123" },
      },
    })
    await host.settle()

    expect(session.claudeRawSdkMessageCount).toBe(2)
    expect(session.capabilities).toBeNull()
  })

  // ─── slice systemprompt-capability — DoD #9: שלושת המצבים ───
  // ⚠️ הטסט הקודם רינדר רכיב-fixture שהעתיק את התנאי ידנית, ולכן עבר גם כשקוד
  // הייצור היה שבור (ממצא כלב, בדיקת-מוטציה). כאן נבדק ה-getter של הייצור עצמו.

  it("showsSystemPromptWarning is false while capabilities are still unknown", async () => {
    expect(session.capabilities).toBeNull()
    expect(session.showsSystemPromptWarning).toBe(false)
  })

  it("showsSystemPromptWarning is true when the provider does not support it", async () => {
    await simulateCaps({ systemPrompt: "unsupported" })

    expect(session.showsSystemPromptWarning).toBe(true)
  })

  it("showsSystemPromptWarning is false when the provider supports it", async () => {
    await simulateCaps({ systemPrompt: "native" })

    expect(session.showsSystemPromptWarning).toBe(false)
  })

  it("showsSystemPromptWarning is false when the provider prepends charter", async () => {
    await simulateCaps({ systemPrompt: "prepended" })

    expect(session.showsSystemPromptWarning).toBe(false)
  })
})
