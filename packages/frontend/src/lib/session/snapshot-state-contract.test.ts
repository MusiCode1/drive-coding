import { readFileSync } from "node:fs"
import {
  createInitialSessionState,
  reduce,
  type SessionState,
  type SnapshotPayload,
  snapshotPayload,
} from "@drive-coding/core/session"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { decodeSnapshotFrame } from "./wire/frame-decode"

const initial = createInitialSessionState({ sessionId: "session-1" })
const transcript = reduce(initial, {
  sessionUpdate: "agent_message",
  messageId: "agent-1",
  content: [{ type: "text", text: "An answer" }],
}).state

const sampledState = {
  version: 42,
  sessionId: transcript.sessionId,
  messages: transcript.messages,
  nextMessageSeq: transcript.nextMessageSeq,
  nextSegmentSeq: transcript.nextSegmentSeq,
  wireSeqIndex: transcript.wireSeqIndex,
  status: "connected",
  turnState: "calling-tool",
  pending: {
    permission: {
      requestId: 12,
      params: {
        sessionId: "session-1",
        toolCall: { toolCallId: "call-1" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      },
    },
    elicitation: {
      requestId: 13,
      params: {
        requestId: "prompt-1",
        mode: "form",
        message: "Continue?",
        requestedSchema: { type: "object", properties: {} },
      },
    },
  },
  capabilities: {
    mcp: true,
    compact: true,
    commands: true,
    usage: true,
    configOptions: true,
    rename: true,
    thinkingTokens: true,
    image: true,
  },
  modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
  configOptions: [
    {
      type: "select",
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "fast",
      options: [{ value: "fast", name: "Fast" }],
    },
  ],
  contextUsage: { used: 27, size: 100, cost: { amount: 1.25, currency: "USD" } },
  quota: { provider: "example", windows: [] },
  title: "Review",
  commands: [{ name: "help", description: "Show help" }],
  lastTurnError: null,
} satisfies SessionState

const internalFields = {
  messageTimestamps: "Buffer consumed by the reducer and represented by timestamps on messages.",
  carried: "Opaque updates are emitted individually and consumed through the raw update stream.",
} satisfies Partial<Record<keyof SessionState, string>>

function readStateFields(url: URL, isReceiver: (receiver: string) => boolean): string[] {
  const source = ts.createSourceFile(
    url.pathname,
    readFileSync(url, "utf8"),
    ts.ScriptTarget.Latest,
  )
  const fields = new Set<string>()
  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && isReceiver(node.expression.getText(source))) {
      fields.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...fields]
}

function checkSnapshot(expected: SessionState, payload: SnapshotPayload): void {
  const restored = decodeSnapshotFrame({ event: "snapshot", data: JSON.stringify(payload) })
  for (const field of Object.keys(sampledState) as (keyof typeof sampledState)[]) {
    expect(restored[field], field).toEqual(expected[field])
  }
}

describe("session snapshot state contract", () => {
  it("maintains coverage for state read by AgentSession and RemoteSessionView", () => {
    const vmFields = readStateFields(
      new URL("../view-models/agent-session.svelte.ts", import.meta.url),
      (receiver) => receiver === "viewState" || receiver === "view.state",
    )
    const viewFields = readStateFields(
      new URL("./remote-session-view.ts", import.meta.url),
      (receiver) => receiver === "snapshot",
    )
    // Keep the fixture exhaustive even when a field reaches the view via an alias.
    const fields: Record<keyof SessionState, unknown> = { ...sampledState, ...internalFields }
    for (const field of [...vmFields, ...viewFields]) {
      expect(Object.hasOwn(sampledState, field), field).toBe(true)
    }
    expect(Object.keys(fields)).toHaveLength(Object.keys(sampledState).length + 2)
  })

  it("round-trips view state and exercises both turn-state encodings", () => {
    checkSnapshot(sampledState, snapshotPayload(sampledState))
    const failed: SessionState = {
      ...sampledState,
      turnState: "idle",
      lastTurnError: { message: "Prompt failed", at: 1234 },
    }
    checkSnapshot(failed, snapshotPayload(failed))
  })

  it("fails the same check when the mode update is omitted", () => {
    const payload = snapshotPayload(sampledState)
    payload.updates = payload.updates.filter(
      (update) => update.sessionUpdate !== "current_mode_update",
    )
    expect(() => checkSnapshot(sampledState, payload)).toThrow(/modes/)
  })
})
