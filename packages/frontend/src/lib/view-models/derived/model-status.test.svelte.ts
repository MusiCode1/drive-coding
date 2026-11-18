/**
 * model-status.test.svelte.ts — T4: isRunActive + stopRunLabelKey.
 *
 * ─── slice control-roles ───
 */

import { describe, expect, it } from "vitest"
import type { AgentSession } from "../agent-session.svelte"
import type { Speaker } from "../speaker.svelte"
import { ModelStatus } from "./model-status.svelte"

function makeModelStatus(turnState: AgentSession["turnState"]): ModelStatus {
  const session = $state({ turnState })
  const speaker = $state({ state: "idle", enabled: true, hasPendingNarration: false })
  return new ModelStatus({
    session: session as unknown as AgentSession,
    speaker: speaker as unknown as Speaker,
  })
}

describe("ModelStatus.isRunActive + stopRunLabelKey", () => {
  it("waiting — active, generic stopRun label", () => {
    const ms = makeModelStatus("waiting")
    expect(ms.isRunActive).toBe(true)
    expect(ms.stopRunLabelKey).toBe("playbackControls.stopRun")
  })

  it("thinking — active, thinking label", () => {
    const ms = makeModelStatus("thinking")
    expect(ms.isRunActive).toBe(true)
    expect(ms.stopRunLabelKey).toBe(["playbackControls", "stopRun", "thinking"].join("."))
  })

  it("responding — active, responding label", () => {
    const ms = makeModelStatus("responding")
    expect(ms.isRunActive).toBe(true)
    expect(ms.stopRunLabelKey).toBe(["playbackControls", "stopRun", "responding"].join("."))
  })

  it("calling-tool — active, callingTool label", () => {
    const ms = makeModelStatus("calling-tool")
    expect(ms.isRunActive).toBe(true)
    expect(ms.stopRunLabelKey).toBe(["playbackControls", "stopRun", "callingTool"].join("."))
  })

  it("idle — inactive, generic stopRun label", () => {
    const ms = makeModelStatus("idle")
    expect(ms.isRunActive).toBe(false)
    expect(ms.stopRunLabelKey).toBe("playbackControls.stopRun")
  })
})
