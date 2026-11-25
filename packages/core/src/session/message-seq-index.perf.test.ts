import { describe, expect, it, vi } from "vitest"
import { reduce } from "./reduce"
import { SEQ_META_KEY } from "./to-session-update"
import { createInitialSessionState } from "./types"

function append(state: ReturnType<typeof createInitialSessionState>, seq: number) {
  return reduce(state, {
    sessionUpdate: "user_message",
    messageId: `mid-${seq}`,
    content: { type: "text", text: `line ${seq}` },
    _meta: { [SEQ_META_KEY]: seq },
  }).state
}

describe("wire sequence lookup during a full fold", () => {
  it("keeps the index private and reuses the earlier lookup work during append", () => {
    const initial = append(createInitialSessionState({ sessionId: "perf" }), 500)
    const first = initial.messages[0]
    if (!first) throw new Error("missing first message")
    const readId = vi.fn(() => "m_500")
    const seed = {
      ...initial,
      messages: [
        {
          ...first,
          get id() {
            return readId()
          },
        },
      ],
    }
    let state = seed
    for (let seq = 501; seq <= 2_500; seq++) {
      state = append(state, seq)
    }
    expect(state.messages).toHaveLength(2_001)
    expect(state.messages.at(-1)?.id).toBe("m_2500")
    expect("wireSeqIndex" in state).toBe(false)
    expect(readId).toHaveBeenCalledTimes(1)
  })

  it("can resume folding either branch of an earlier state", () => {
    const seed = append(createInitialSessionState({ sessionId: "perf" }), 500)
    const a = append(seed, 507)
    const b = append(seed, 509)
    expect(append(a, 507).messages.map(({ id }) => id)).toEqual(["m_500", "m_507"])
    expect(append(b, 507).messages.map(({ id }) => id)).toEqual(["m_500", "m_509", "m_507"])
  })
})
