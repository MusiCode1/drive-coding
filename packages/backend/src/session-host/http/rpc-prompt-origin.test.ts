/**
 * rpc-prompt-origin.test.ts — who the backend thinks sent a session/prompt.
 *
 * The cases that matter are the ones a reader would assume are safe: an agent id we do
 * not recognise must not buy an agent label, and the FE must stay unwrapped.
 */

import type { AgentRegistry } from "@drive-coding/core"
import { describe, expect, it } from "vitest"
import { CALLER_NAME_MAX } from "../../agent-identity.js"
import { apiEnvelopeEnabled, gateApiEnvelope, resolvePromptOrigin } from "./rpc-prompt.js"

const KNOWN = "11111111-1111-4111-8111-111111111111"

function registry(records: Record<string, unknown> = {}): AgentRegistry {
  return {
    get: async (id: string) => records[id],
  } as unknown as AgentRegistry
}

const withKnownAgent = registry({ [KNOWN]: { id: KNOWN, roleLabel: "yetro" } })

describe("resolvePromptOrigin", () => {
  it("a known agent id wins over any declared client kind", async () => {
    const origin = await resolvePromptOrigin(withKnownAgent, {
      agentId: KNOWN,
      clientKind: "ui",
      callerName: "pretending",
    })

    expect(origin).toEqual({ kind: "agent", sender: { id: KNOWN, name: "yetro" } })
  })

  it("an agent id we do not know falls to api, never to agent", async () => {
    const origin = await resolvePromptOrigin(registry(), { agentId: "not-in-registry" })

    expect(origin.kind).toBe("api")
  })

  it("the FE header yields ui, which stays unwrapped", async () => {
    expect(await resolvePromptOrigin(registry(), { clientKind: "ui" })).toEqual({ kind: "ui" })
  })

  it("the client kind is matched case-insensitively", async () => {
    expect(await resolvePromptOrigin(registry(), { clientKind: " UI " })).toEqual({ kind: "ui" })
  })

  it("no headers at all is api with no caller — the default for an outside script", async () => {
    expect(await resolvePromptOrigin(registry(), {})).toEqual({ kind: "api" })
  })

  it("carries a declared name and kind through", async () => {
    const origin = await resolvePromptOrigin(registry(), {
      callerName: "n8n · workflow 12",
      callerKind: "tool",
    })

    expect(origin).toEqual({
      kind: "api",
      caller: { kind: "tool", name: "n8n · workflow 12" },
    })
  })

  it("an unknown caller kind is passed through, not rejected", async () => {
    const origin = await resolvePromptOrigin(registry(), { callerKind: "spaceship" })

    expect(origin).toEqual({ kind: "api", caller: { kind: "spaceship" } })
  })

  it("caps a declared name — it reaches the child prompt and the UI", async () => {
    const origin = await resolvePromptOrigin(registry(), { callerName: "x".repeat(500) })

    expect(origin.kind).toBe("api")
    if (origin.kind === "api") expect(origin.caller?.name).toHaveLength(CALLER_NAME_MAX)
  })

  it("whitespace-only headers count as absent", async () => {
    expect(await resolvePromptOrigin(registry(), { callerName: "   ", callerKind: "\t" })).toEqual({
      kind: "api",
    })
  })
})

describe("gateApiEnvelope", () => {
  it("while the flag is off an api prompt takes the unwrapped path", () => {
    expect(gateApiEnvelope({ kind: "api", caller: { name: "ci" } }, false)).toEqual({ kind: "ui" })
  })

  it("with the flag on the api origin survives intact", () => {
    const origin = { kind: "api", caller: { name: "ci" } } as const
    expect(gateApiEnvelope(origin, true)).toBe(origin)
  })

  it("never touches an agent origin, flag either way", () => {
    const origin = { kind: "agent", sender: { id: KNOWN } } as const
    expect(gateApiEnvelope(origin, false)).toBe(origin)
    expect(gateApiEnvelope(origin, true)).toBe(origin)
  })
})

describe("apiEnvelopeEnabled", () => {
  it("defaults to off when the variable is absent", () => {
    expect(apiEnvelopeEnabled({})).toBe(false)
  })

  it("only an explicit 1 turns it on", () => {
    expect(apiEnvelopeEnabled({ API_MESSAGE_ENVELOPE: "1" })).toBe(true)
    expect(apiEnvelopeEnabled({ API_MESSAGE_ENVELOPE: "true" })).toBe(false)
    expect(apiEnvelopeEnabled({ API_MESSAGE_ENVELOPE: "0" })).toBe(false)
  })
})

describe("UTF-8 header recovery", () => {
  /** What a client actually puts on the wire: UTF-8 bytes read back as latin-1. */
  function asLatin1(utf8: string): string {
    return Array.from(new TextEncoder().encode(utf8), (b) => String.fromCharCode(b)).join("")
  }

  it("recovers a Hebrew caller name instead of storing mojibake", async () => {
    const origin = await resolvePromptOrigin(registry(), {
      callerName: asLatin1("סוכן הלילה"),
    })

    expect(origin.kind).toBe("api")
    if (origin.kind === "api") expect(origin.caller?.name).toBe("סוכן הלילה")
  })

  it("recovers a middle dot — the case that first showed the bug", async () => {
    const origin = await resolvePromptOrigin(registry(), {
      callerName: asLatin1("n8n · nightly deploy"),
    })

    if (origin.kind === "api") expect(origin.caller?.name).toBe("n8n · nightly deploy")
  })

  it("leaves pure ASCII untouched", async () => {
    const origin = await resolvePromptOrigin(registry(), { callerName: "ci-runner" })

    if (origin.kind === "api") expect(origin.caller?.name).toBe("ci-runner")
  })

  it("keeps bytes that are not valid UTF-8 as they came, rather than mangling them", async () => {
    // 0xFF is never a legal UTF-8 lead byte; the fallback must return the original.
    const origin = await resolvePromptOrigin(registry(), { callerName: "caf\u00ff" })

    if (origin.kind === "api") expect(origin.caller?.name).toBe("caf\u00ff")
  })

  it("caps after decoding, so a multi-byte name is not cut mid-character count", async () => {
    const origin = await resolvePromptOrigin(registry(), {
      callerName: asLatin1("א".repeat(300)),
    })

    if (origin.kind === "api") expect(origin.caller?.name).toHaveLength(CALLER_NAME_MAX)
  })
})
