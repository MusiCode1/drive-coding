/**
 * sidecar-backend.mode.test.ts — which way a sidecar holds its agent.
 *
 * The mode is not cosmetic: it decides whether `_drive/getQuota` and
 * `_drive/setThinkingTokens` work at all. Measured against a live sidecar —
 * pipe answers `-32601 Method not found` for both, hosted answers a real quota
 * snapshot and `{ok:true}`.
 */

import { describe, expect, it } from "vitest"
import { defaultModeFor, lineSplitter } from "../src/agents/sidecar-backend.js"

describe("defaultModeFor", () => {
  it("🔴 hosts the adapters that own the _drive/* methods", () => {
    // In pipe mode those two methods are gone: they need the SDK object, which
    // only an in-process adapter holds.
    expect(defaultModeFor("claude")).toBe("hosted")
    expect(defaultModeFor("codex")).toBe("hosted")
  })

  it("pipes the CLIs that speak ACP themselves", () => {
    for (const kind of ["cursor", "opencode", "gemini"]) {
      expect(defaultModeFor(kind)).toBe("pipe")
    }
  })

  it("an unknown cliKind falls to pipe rather than failing to start", () => {
    expect(defaultModeFor("something-new")).toBe("pipe")
  })
})

describe("lineSplitter", () => {
  it("🔴 reassembles a line split across chunks", () => {
    // A large session/update arrives in several reads; splitting per chunk
    // would corrupt most of them.
    const seen: string[] = []
    const feed = lineSplitter((l) => seen.push(l))
    feed('{"jsonrpc":"2.0"')
    expect(seen).toEqual([])
    feed(',"id":1}\n')
    expect(seen).toEqual(['{"jsonrpc":"2.0","id":1}'])
  })

  it("splits several lines arriving together", () => {
    const seen: string[] = []
    const feed = lineSplitter((l) => seen.push(l))
    feed("a\nb\nc\n")
    expect(seen).toEqual(["a", "b", "c"])
  })

  it("drops empty lines rather than forwarding blank frames", () => {
    const seen: string[] = []
    const feed = lineSplitter((l) => seen.push(l))
    feed("\n\nx\n\n")
    expect(seen).toEqual(["x"])
  })

  it("holds an unterminated tail instead of emitting a partial frame", () => {
    const seen: string[] = []
    const feed = lineSplitter((l) => seen.push(l))
    feed("complete\nincomplete")
    expect(seen).toEqual(["complete"])
  })
})
