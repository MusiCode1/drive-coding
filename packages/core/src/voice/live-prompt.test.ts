/**
 * live-prompt.test.ts — delivery markers and system-prompt sections.
 *
 * Slice: live-secretary fix1, Commit A+B.
 */

import { describe, expect, it } from "vitest"
import {
  buildLiveSecretaryPrompt,
  formatAgentDelivery,
  formatPermissionPending,
  LIVE_AGENT_DELIVERY_MARKER,
  LIVE_PERMISSION_PENDING_MARKER,
} from "./live-prompt"

describe("formatAgentDelivery", () => {
  it("prefixes agent answer with the exported marker constant", () => {
    expect(formatAgentDelivery("auth.test.ts passed")).toBe(
      `${LIVE_AGENT_DELIVERY_MARKER} auth.test.ts passed`,
    )
  })
})

describe("formatPermissionPending", () => {
  it("includes marker, tool title, and option list", () => {
    const text = formatPermissionPending({
      toolTitle: "Run command",
      options: [
        { optionId: "allow-1", name: "Allow once" },
        { optionId: "deny-1", name: "Deny" },
      ],
    })
    expect(text.startsWith(LIVE_PERMISSION_PENDING_MARKER)).toBe(true)
    expect(text).toContain("Run command")
    expect(text).toContain("allow-1: Allow once")
    expect(text).toContain("deny-1: Deny")
  })
})

describe("buildLiveSecretaryPrompt", () => {
  it("includes agent-delivery and permission sections referencing exported markers", () => {
    const prompt = buildLiveSecretaryPrompt()
    expect(prompt).toContain(LIVE_AGENT_DELIVERY_MARKER)
    expect(prompt).toContain("אל תשגר אותו מחדש לסוכן ב-compose_prompt")
    expect(prompt).toContain(LIVE_PERMISSION_PENDING_MARKER)
    expect(prompt).toContain("answer_permission")
    expect(prompt).toContain("read_recent")
    expect(prompt).toContain("כלים — זה מה שכל כלי עושה באמת")
  })
})
