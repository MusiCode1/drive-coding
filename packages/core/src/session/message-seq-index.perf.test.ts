import { describe, expect, it } from "vitest"
import { reduce } from "./reduce"
import { SEQ_META_KEY } from "./to-session-update"
import { createInitialSessionState } from "./types"

const N = 10_000

describe("wire seq index fold performance", () => {
  it(`folding ${N} whole messages with seq stays within baseline scale`, () => {
    let state = createInitialSessionState({ sessionId: "perf" })
    const updates = Array.from({ length: N }, (_, i) => ({
      sessionUpdate: "user_message_chunk" as const,
      messageId: `mid-${i}`,
      content: { type: "text" as const, text: `line ${i}` },
      _meta: { [SEQ_META_KEY]: i },
    }))
    const start = performance.now()
    for (const u of updates) {
      state = reduce(state, u).state
    }
    const ms = performance.now() - start
    expect(state.messages).toHaveLength(N)
    expect(state.messages[N - 1]?.id).toBe(`m_${N - 1}`)
    // Base ~618ms for 10k without index regression; allow generous CI headroom.
    expect(ms).toBeLessThan(2_500)
  })
})