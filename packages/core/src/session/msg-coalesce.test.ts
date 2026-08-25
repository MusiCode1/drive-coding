/**
 * msg-coalesce.test.ts — gates for slice msg-coalesce (bug #53).
 *
 * Coalesce agent message chunks across tool/thought interleaving in handleTextChunk.
 * G2 fold mirrors foldSnapshot in packages/frontend/src/lib/session/sse-reader.ts.
 */
import { describe, expect, it } from "vitest"
import { reduce } from "./reduce"
import { snapshotFrame } from "./wire-frames"
import { createInitialSessionState } from "./types"
import type { SessionState } from "./types"

function run(us: unknown[]): SessionState {
  let s = createInitialSessionState({ sessionId: "test" })
  for (const u of us) s = reduce(s, u).state
  return s
}

/** Mirrors foldSnapshot in packages/frontend/src/lib/session/sse-reader.ts */
function foldSnapshotFromWire(be: SessionState): SessionState {
  const snap = JSON.parse(snapshotFrame(be).data) as {
    sessionId: string
    version: number
    updates: unknown[]
  }
  let st = createInitialSessionState({ sessionId: snap.sessionId })
  for (const u of snap.updates) st = reduce(st, u).state
  return { ...st, sessionId: snap.sessionId, version: snap.version }
}

const ch = (t: string, mid: string | null, kind = "agent_message_chunk") => ({
  sessionUpdate: kind,
  messageId: mid,
  content: { type: "text", text: t },
})
const th = (t: string, mid: string | null) => ch(t, mid, "agent_thought_chunk")
const usr = (t: string, mid: string) => ch(t, mid, "user_message_chunk")
const tool = (id: string) => ({
  sessionUpdate: "tool_call",
  toolCallId: id,
  title: "x",
  status: "completed",
})

function assistantBubbles(s: SessionState) {
  return s.messages.filter((m) => m.role === "assistant")
}

function assistantText(s: SessionState): string {
  return assistantBubbles(s)
    .map((m) => m.segments.map((g) => g.text).join(""))
    .join("")
}

function thoughtBubbles(s: SessionState) {
  return s.messages.filter((m) => m.role === "thought")
}

function nonToolRoles(s: SessionState): string[] {
  return s.messages.filter((m) => m.role !== "tool").map((m) => m.role)
}

// ─── G1 — provider vocabulary: chunk · tool · chunk ───

describe("G1 — chunk coalesce across tool", () => {
  it("A(X) · tool · B(X) ⇒ one assistant bubble, text A+B", () => {
    const s = run([ch("A", "X"), tool("t1"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(1)
    expect(assistantText(s)).toBe("AB")
  })
})

// ─── G2 — full BE → snapshotFrame → fold, zero text loss ───

describe("G2 — BE snapshot round-trip fidelity", () => {
  it("chunk path with tool interleaving survives snapshot fold without text loss", () => {
    const be = run([ch("A", "X"), tool("t1"), ch("B", "X")])
    const fe = foldSnapshotFromWire(be)
    expect(assistantText(fe)).toBe(assistantText(be))
    expect(assistantBubbles(fe)).toHaveLength(assistantBubbles(be).length)
  })
})

// ─── G3 — 13 boundary cases (§3ה) ───

describe("G3 — boundary cases", () => {
  it("1: multiple adjacent tools — merges", () => {
    const s = run([ch("A", "X"), tool("t1"), tool("t2"), tool("t3"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(1)
    expect(assistantText(s)).toBe("AB")
  })

  it("2: user message between — does NOT merge (hard boundary)", () => {
    const s = run([ch("A", "X"), tool("t1"), usr("q", "U1"), ch("B", "X")])
    const asst = assistantBubbles(s)
    expect(asst).toHaveLength(2)
    expect(asst[0]!.segments.map((g) => g.text).join("")).toBe("A")
    expect(asst[1]!.segments.map((g) => g.text).join("")).toBe("B")
  })

  it("3: different messageId — does NOT merge", () => {
    const s = run([ch("A", "X"), tool("t1"), ch("B", "Y")])
    expect(assistantBubbles(s)).toHaveLength(2)
  })

  it("4: Gemini null-mid — does NOT merge over tool", () => {
    const s = run([ch("A", null), tool("t1"), ch("B", null)])
    expect(assistantBubbles(s)).toHaveLength(2)
  })

  it("5: thought·tool·thought — merges thought chunks", () => {
    const s = run([th("A", "X"), tool("t1"), th("B", "X")])
    expect(thoughtBubbles(s)).toHaveLength(1)
    expect(thoughtBubbles(s)[0]!.segments.map((g) => g.text).join("")).toBe("AB")
  })

  it("6: foreign assistant between — does NOT merge across", () => {
    const s = run([ch("A", "X"), tool("t1"), ch("Z", "Y"), tool("t2"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(3)
    expect(assistantText(s)).toBe("AZB")
  })

  it("7: A·thought(X)·tool·B — merges assistant", () => {
    const s = run([ch("A", "X"), th("T", "X"), tool("t1"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(1)
    expect(assistantText(s)).toBe("AB")
  })

  it("8: A·tool·thought(X)·B — merges assistant", () => {
    const s = run([ch("A", "X"), tool("t1"), th("T", "X"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(1)
    expect(assistantText(s)).toBe("AB")
  })

  it("9: A·thought(X)·B without tool — merges assistant", () => {
    const s = run([ch("A", "X"), th("T", "X"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(1)
    expect(assistantText(s)).toBe("AB")
  })

  it("10: thought with different mid blocks — does NOT merge assistant", () => {
    const s = run([ch("A", "X"), th("T", "Y"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(2)
  })

  it("11: sequence starting with tool — new bubble, no backward merge", () => {
    const s = run([tool("t1"), ch("A", "X")])
    expect(assistantBubbles(s)).toHaveLength(1)
    expect(assistantText(s)).toBe("A")
  })

  it("12b: user with same mid — does NOT merge (defensive belt)", () => {
    const s = run([ch("A", "X"), usr("q", "X"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(2)
  })

  it("12: thought merges above assistant of same mid", () => {
    const s = run([th("T1", "X"), ch("A", "X"), th("T2", "X")])
    expect(thoughtBubbles(s)).toHaveLength(1)
    expect(thoughtBubbles(s)[0]!.segments.map((g) => g.text).join("")).toBe("T1T2")
  })
})

// ─── G4 — thought interleaving without tool: order + count ───

describe("G4 — thought interleaving preserves order", () => {
  it("A(X)·thought(X)·B(X) ⇒ one assistant + separate thought, assistant before thought", () => {
    const s = run([ch("A", "X"), th("T", "X"), ch("B", "X")])
    expect(assistantBubbles(s)).toHaveLength(1)
    expect(assistantText(s)).toBe("AB")
    expect(thoughtBubbles(s)).toHaveLength(1)
    expect(thoughtBubbles(s)[0]!.segments.map((g) => g.text).join("")).toBe("T")
    expect(nonToolRoles(s)).toEqual(["assistant", "thought"])
  })
})
