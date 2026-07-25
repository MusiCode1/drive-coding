/**
 * schema.test.ts — TDD (Red → Green) for extMethods registry and parseExtParams.
 *
 * Phase 0: schema validates valid params (including n=null); rejects invalid (missing n,
 * wrong type for n, sessionId not string).
 *
 * Commit 0 (session-budget-meter): provider-agnostic quota contract —
 * QuotaPeriod/QuotaConsumption/QuotaWindow/QuotaSnapshot + _drive/getQuota
 * params/result validation via parseExtParams/parseExtResult.
 */

import { describe, expect, it } from "vitest"
import { parseExtParams, parseExtResult } from "./types.js"

describe("parseExtParams — _drive/setThinkingTokens", () => {
  it("accepts valid params with n as positive number", () => {
    const result = parseExtParams("_drive/setThinkingTokens", {
      sessionId: "sess-abc",
      n: 8000,
    })
    expect(result).toEqual({ sessionId: "sess-abc", n: 8000 })
  })

  it("accepts valid params with n=null (no-limit)", () => {
    const result = parseExtParams("_drive/setThinkingTokens", {
      sessionId: "sess-xyz",
      n: null,
    })
    expect(result).toEqual({ sessionId: "sess-xyz", n: null })
  })

  it("accepts n=0 (zero thinking tokens)", () => {
    const result = parseExtParams("_drive/setThinkingTokens", {
      sessionId: "s",
      n: 0,
    })
    expect(result).toEqual({ sessionId: "s", n: 0 })
  })

  it("rejects when n is missing", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        sessionId: "sess-abc",
      }),
    ).toThrow()
  })

  it("rejects when n is a string", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        sessionId: "sess-abc",
        n: "8000",
      }),
    ).toThrow()
  })

  it("rejects when sessionId is missing", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        n: 8000,
      }),
    ).toThrow()
  })

  it("rejects when sessionId is a number", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", {
        sessionId: 123,
        n: 8000,
      }),
    ).toThrow()
  })

  it("rejects when params is not an object", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", "invalid"),
    ).toThrow()
  })

  it("rejects when params is null", () => {
    expect(() =>
      parseExtParams("_drive/setThinkingTokens", null),
    ).toThrow()
  })
})

describe("parseExtParams — _drive/getQuota", () => {
  it("accepts valid params { sessionId }", () => {
    const result = parseExtParams("_drive/getQuota", { sessionId: "sess-1" })
    expect(result).toEqual({ sessionId: "sess-1" })
  })

  it("rejects when sessionId is missing", () => {
    expect(() => parseExtParams("_drive/getQuota", {})).toThrow()
  })

  it("rejects when sessionId is not a string", () => {
    expect(() => parseExtParams("_drive/getQuota", { sessionId: 1 })).toThrow()
  })

  it("rejects when params is null", () => {
    expect(() => parseExtParams("_drive/getQuota", null)).toThrow()
  })
})

describe("parseExtResult — _drive/getQuota", () => {
  it("accepts snapshot:null (valid — no limits available)", () => {
    const result = parseExtResult("_drive/getQuota", { snapshot: null })
    expect(result).toEqual({ snapshot: null })
  })

  it("accepts a rolling-percentage window", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        plan: "max",
        windows: [
          {
            id: "five_hour",
            period: { kind: "rolling", durationSeconds: 5 * 60 * 60 },
            consumption: { kind: "percentage", usedPct: 42 },
            resetsAtMs: 1_700_000_000_000,
          },
        ],
      },
    }
    const result = parseExtResult("_drive/getQuota", raw)
    expect(result).toEqual(raw)
  })

  it("accepts a calendar-absolute window (monthly, generic — no provider branching)", () => {
    const raw = {
      snapshot: {
        provider: "synthetic",
        windows: [
          {
            id: "monthly",
            period: { kind: "calendar", unit: "month" },
            consumption: { kind: "absolute", used: 40, limit: 100, unit: "requests" },
            resetsAtMs: null,
          },
        ],
      },
    }
    const result = parseExtResult("_drive/getQuota", raw)
    expect(result).toEqual(raw)
  })

  it("accepts multiple windows in one snapshot", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "five_hour",
            period: { kind: "rolling", durationSeconds: 18_000 },
            consumption: { kind: "percentage", usedPct: 10 },
            resetsAtMs: 1,
          },
          {
            id: "seven_day",
            period: { kind: "rolling", durationSeconds: 604_800 },
            consumption: { kind: "percentage", usedPct: 90 },
            resetsAtMs: 2,
          },
        ],
      },
    }
    const result = parseExtResult("_drive/getQuota", raw)
    expect(result).toEqual(raw)
  })

  it("accepts an empty windows array", () => {
    const raw = { snapshot: { provider: "claude", windows: [] } }
    expect(parseExtResult("_drive/getQuota", raw)).toEqual(raw)
  })

  it("rejects top-level bare null (must be { snapshot: null }, never a bare null)", () => {
    expect(() => parseExtResult("_drive/getQuota", null)).toThrow()
  })

  it("rejects missing top-level snapshot key", () => {
    expect(() => parseExtResult("_drive/getQuota", {})).toThrow()
  })

  it("rejects negative durationSeconds on a rolling period", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "rolling", durationSeconds: -1 },
            consumption: { kind: "percentage", usedPct: 10 },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("rejects zero durationSeconds on a rolling period", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "rolling", durationSeconds: 0 },
            consumption: { kind: "percentage", usedPct: 10 },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("rejects usedPct above 100", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "rolling", durationSeconds: 10 },
            consumption: { kind: "percentage", usedPct: 101 },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("rejects usedPct below 0", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "rolling", durationSeconds: 10 },
            consumption: { kind: "percentage", usedPct: -1 },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("rejects negative absolute `used`", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "calendar", unit: "month" },
            consumption: { kind: "absolute", used: -1, limit: 100, unit: "requests" },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("rejects absolute `limit` of 0 (division by zero guard belongs at the schema level)", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "calendar", unit: "month" },
            consumption: { kind: "absolute", used: 0, limit: 0, unit: "requests" },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("rejects an unknown period kind", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "yearly" },
            consumption: { kind: "percentage", usedPct: 10 },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("rejects an unknown consumption kind", () => {
    const raw = {
      snapshot: {
        provider: "claude",
        windows: [
          {
            id: "x",
            period: { kind: "rolling", durationSeconds: 10 },
            consumption: { kind: "unlimited" },
            resetsAtMs: null,
          },
        ],
      },
    }
    expect(() => parseExtResult("_drive/getQuota", raw)).toThrow()
  })

  it("includes the method name in the thrown error message", () => {
    expect(() => parseExtResult("_drive/getQuota", { snapshot: "not-an-object" })).toThrow(
      /_drive\/getQuota/,
    )
  })
})
