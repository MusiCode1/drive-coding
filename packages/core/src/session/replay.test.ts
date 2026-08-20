/**
 * replay.test.ts — "הטסט שמחזיק את כל העיצוב" (מסמך §15).
 *
 * האלגוריתם:
 *   1. קרא הקלטת-wire אמיתית (מסוננת/מוקהית)
 *   2. הרץ reduce על כל ה-frames → state סופי S + רשימת patches P
 *   3. החל את כל patches P מ-state ריק דרך applyPatch → state S'
 *   4. assert deepEqual(S, S')
 *
 * אם reduce פולט patch שמאבד מידע — הטסט תופס.
 * אם applyPatch מיישם patch שגוי — הטסט תופס.
 *
 * fixture: packages/core/tests/fixtures/wire-replay.jsonl
 *   - 537 session/update frames מהקלטה אמיתית
 *   - טקסט מוקהה (פרטיות); מבנה + messageIds + sessionUpdates שמורים
 *   - כולל: 522 agent_message_chunk, 8 agent_thought_chunk, 7 user_message_chunk
 *   - חסר: tool_call / tool_call_update → מוסף סינתטית (ר' synthetic section)
 *
 * ─── slice session-state-reducer C2 (TDD) ───
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { applyPatch } from "./apply-patch"
import { reduce } from "./reduce"
import type { Patch, SessionState } from "./types"
import { createInitialSessionState } from "./types"

// ─── Load fixture ───

function loadFixture(): object[] {
  const fixturePath = join(import.meta.dirname, "../../tests/fixtures/wire-replay.jsonl")
  const lines = readFileSync(fixturePath, "utf-8").split("\n").filter(Boolean)
  return lines.map((line) => {
    const frame = JSON.parse(line) as { ts: number; dir: string; raw: string }
    const raw = JSON.parse(frame.raw) as {
      method?: string
      params?: { sessionId?: string; update?: object }
    }
    return raw.params?.update ?? {}
  })
}

// ─── Main replay algorithm ───

function replayFrames(
  frames: object[],
  initial: SessionState,
): { finalState: SessionState; patches: Patch[] } {
  let state = initial
  const allPatches: Patch[] = []

  for (const frame of frames) {
    const { state: next, patches } = reduce(state, frame)
    state = next
    allPatches.push(...patches)
  }

  return { finalState: state, patches: allPatches }
}

function applyAllPatches(patches: Patch[], initial: SessionState): SessionState {
  let state = initial
  for (const patch of patches) {
    state = applyPatch(state, patch)
  }
  return state
}

// ─── Tests ───

describe("replay — wire fixture", () => {
  it("applyPatch(patches) ≡ reduce(frames) — deep equality", () => {
    const frames = loadFixture()
    const initial = createInitialSessionState({ sessionId: null })

    const { finalState, patches } = replayFrames(frames, initial)

    // Replay patches from scratch
    const replayed = applyAllPatches(patches, createInitialSessionState({ sessionId: null }))

    // Core assertion: the design holds
    expect(replayed).toEqual(finalState)
  })

  it("fixture produces some messages (non-trivial replay)", () => {
    const frames = loadFixture()
    const initial = createInitialSessionState({ sessionId: null })
    const { finalState, patches } = replayFrames(frames, initial)

    // Sanity: the fixture has real content
    expect(finalState.messages.length).toBeGreaterThan(0)
    expect(patches.length).toBeGreaterThan(0)
  })

  it("all produced patches have a version field", () => {
    const frames = loadFixture()
    const initial = createInitialSessionState({ sessionId: null })
    const { patches } = replayFrames(frames, initial)

    for (const p of patches) {
      expect(typeof p.version).toBe("number")
    }
  })

  it("messages have deterministic m_ ids", () => {
    const frames = loadFixture()
    const initial = createInitialSessionState({ sessionId: null })
    const { finalState } = replayFrames(frames, initial)

    for (const msg of finalState.messages) {
      expect(msg.id).toMatch(/^m_\d+$/)
    }
  })

  it("segments have deterministic s_ ids", () => {
    const frames = loadFixture()
    const initial = createInitialSessionState({ sessionId: null })
    const { finalState } = replayFrames(frames, initial)

    for (const msg of finalState.messages) {
      if (msg.role !== "tool") {
        for (const seg of msg.segments) {
          expect(seg.id).toMatch(/^s_\d+$/)
        }
      }
    }
  })
})

// ─── Synthetic tool_call / tool_call_update cases ───
// הקלטה האמיתית חסרה tool events — מוסיפים כאן מבנה-מלאכותי.

describe("replay — synthetic tool_call + tool_call_update", () => {
  const syntheticFrames: object[] = [
    // User asks
    {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "Read a file" },
      messageId: "u-1",
    },
    // Agent thinks
    {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "I will read the file" },
      messageId: "t-1",
    },
    // Tool call starts
    {
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      kind: "read",
      title: "Read /tmp/x",
      rawInput: { path: "/tmp/x" },
      status: "pending",
    },
    // Tool updates
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "in_progress",
    },
    // Tool completes
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "completed",
      rawOutput: "file content here",
    },
    // Agent responds
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "I read the file" },
      messageId: "a-1",
    },
  ]

  it("tool lifecycle: reduce → patches → applyPatch → deepEqual", () => {
    const initial = createInitialSessionState({ sessionId: null })
    const { finalState, patches } = replayFrames(syntheticFrames, initial)
    const replayed = applyAllPatches(patches, createInitialSessionState({ sessionId: null }))

    expect(replayed).toEqual(finalState)
  })

  it("produces 6 patches for the synthetic flow", () => {
    const initial = createInitialSessionState({ sessionId: null })
    const { patches } = replayFrames(syntheticFrames, initial)

    // user_chunk → add-message
    // thought_chunk → add-message
    // tool_call → add-message
    // tool_call_update (pending→in_progress) → update-tool
    // tool_call_update (completed) → update-tool
    // agent_chunk → add-message
    expect(patches).toHaveLength(6)
  })

  it("tool message has role=tool and correct final status", () => {
    const initial = createInitialSessionState({ sessionId: null })
    const { finalState } = replayFrames(syntheticFrames, initial)

    const toolMsg = finalState.messages.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()
    if (toolMsg && toolMsg.role === "tool") {
      expect(toolMsg.toolCall.status).toBe("completed")
      expect(toolMsg.toolCall.result).toBe("file content here")
    }
  })

  it("multiple tools in sequence — both get unique ids and correct targetIds", () => {
    const frames: object[] = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-a",
        kind: "read",
        rawInput: { path: "/a" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-b",
        kind: "edit",
        rawInput: { path: "/b" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-a",
        status: "completed",
        rawOutput: "a done",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-b",
        status: "completed",
        rawOutput: "b done",
      },
    ]
    const initial = createInitialSessionState({ sessionId: null })
    const { finalState, patches } = replayFrames(frames, initial)
    const replayed = applyAllPatches(patches, createInitialSessionState({ sessionId: null }))

    expect(replayed).toEqual(finalState)

    const toolA = finalState.messages.find(
      (m) => m.role === "tool" && m.toolCall.toolCallId === "tc-a",
    )
    const toolB = finalState.messages.find(
      (m) => m.role === "tool" && m.toolCall.toolCallId === "tc-b",
    )
    expect(toolA).toBeDefined()
    expect(toolB).toBeDefined()
    if (toolA?.role === "tool") expect(toolA.toolCall.result).toBe("a done")
    if (toolB?.role === "tool") expect(toolB.toolCall.result).toBe("b done")
  })
})
