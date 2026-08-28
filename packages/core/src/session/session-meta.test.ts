import { describe, expect, it } from "vitest"
import { sessionMetaFor } from "./session-meta"

describe("sessionMetaFor", () => {
  it('returns Claude session meta when cliKind is "claude"', () => {
    const meta = sessionMetaFor("claude")
    expect(meta).toBeDefined()
    expect(meta?.claudeCode).toBeDefined()
    expect(meta?.claudeCode).toMatchObject({
      options: {
        thinking: { type: "adaptive", display: "summarized" },
        forwardSubagentText: true,
      },
    })
    expect(meta?.claudeCode).toHaveProperty("emitRawSDKMessages")
  })

  it('returns undefined for non-claude providers', () => {
    expect(sessionMetaFor("opencode")).toBeUndefined()
    expect(sessionMetaFor("gemini")).toBeUndefined()
    expect(sessionMetaFor("")).toBeUndefined()
  })
})
