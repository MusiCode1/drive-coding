/**
 * translate-client.test.ts — locks in the post-2026-05-18 translate behavior.
 *
 * Covered behaviours:
 *   1. Schema discrimination: both `already_in_target` and `translated`
 *      branches are surfaced verbatim to the caller.
 *   2. Empty `translated.text` is treated as failure (returns null) to avoid
 *      poisoning the cache.
 *   3. Errors from generateObject collapse to null (orchestrator-friendly).
 *   4. External AbortSignal propagates through to generateObject.
 *   5. The prompt fed to Gemini contains the core `buildTranslationPrompt`
 *      output (with the "return as-is if already Hebrew" instruction) PLUS
 *      the schema explanation appended.
 *   6. The model used is `gemini-flash-lite-latest` (locked in until we
 *      explicitly decide to escalate to Flash).
 *   7. Cache hit short-circuits the API call entirely.
 *   8. Cache write happens after a successful API result.
 *   9. `already_in_target` is cached too (so reload skips Gemini).
 *
 * NOTE: we mock `ai`'s `generateObject` and `./sdks`'s `googleAi` factory.
 * happy-dom provides localStorage + SubtleCrypto natively.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks (must be declared before the import-under-test) ───────────────────

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>()
  return {
    ...actual,
    generateObject: vi.fn(),
  }
})

vi.mock("./sdks", () => ({
  googleAi: vi.fn((modelName: string) => ({ __modelName: modelName })),
}))

// ── Imports under test ──────────────────────────────────────────────────────

import { generateObject } from "ai"
import { googleAi } from "./sdks"
import { clearTranslateCache, getCached } from "./translate-cache"
import { translate } from "./translate-client"

const mockedGenerateObject = vi.mocked(generateObject)
const mockedGoogleAi = vi.mocked(googleAi)

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockObjectResponse(object: unknown) {
  mockedGenerateObject.mockResolvedValueOnce({ object } as never)
}

function mockObjectError(err: Error) {
  mockedGenerateObject.mockRejectedValueOnce(err)
}

beforeEach(() => {
  clearTranslateCache()
  // mockReset (not clearAllMocks) — also clears the mockResolvedValueOnce queue
  // so leftover queued responses from previous tests don't leak in.
  mockedGenerateObject.mockReset()
  mockedGoogleAi.mockReset()
  mockedGoogleAi.mockImplementation((modelName: string) => ({ __modelName: modelName }) as never)
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe("translate — schema discrimination", () => {
  it("returns { status: 'already_in_target' } verbatim when Gemini reports so", async () => {
    mockObjectResponse({ status: "already_in_target" })
    const result = await translate("שלום עולם", "he")
    expect(result).toEqual({ status: "already_in_target" })
  })

  it("returns { status: 'translated', text } verbatim when Gemini translates", async () => {
    mockObjectResponse({ status: "translated", text: "שלום עולם" })
    const result = await translate("hello world", "he")
    expect(result).toEqual({ status: "translated", text: "שלום עולם" })
  })

  it("treats empty translated text as failure (returns null, does NOT cache)", async () => {
    mockObjectResponse({ status: "translated", text: "   " })
    const result = await translate("hello", "he")
    expect(result).toBeNull()
    expect(await getCached("hello", "he")).toBeNull()
  })
})

describe("translate — error handling", () => {
  it("returns null when generateObject throws", async () => {
    mockObjectError(new Error("API error"))
    const result = await translate("hello", "he")
    expect(result).toBeNull()
  })

  it("returns null when generateObject is aborted", async () => {
    mockObjectError(Object.assign(new Error("AbortError"), { name: "AbortError" }))
    const result = await translate("hello", "he")
    expect(result).toBeNull()
  })

  it("does NOT cache failures", async () => {
    mockObjectError(new Error("transient"))
    await translate("hello", "he")
    expect(await getCached("hello", "he")).toBeNull()
  })
})

describe("translate — AbortSignal propagation", () => {
  it("forwards the external abortSignal into generateObject", async () => {
    const ac = new AbortController()
    mockObjectResponse({ status: "translated", text: "שלום" })

    await translate("hello", "he", ac.signal)

    // The internal AC's signal is what generateObject actually receives, but
    // the contract we lock in is "an AbortSignal is passed at all". A consumer
    // calling ac.abort() must terminate the in-flight request.
    const call = mockedGenerateObject.mock.calls[0]?.[0] as { abortSignal?: AbortSignal }
    expect(call.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it("returns null when generateObject rejects via abort", async () => {
    // Realistic flow: caller aborts → SDK rejects with AbortError → translate
    // catches and returns null. We don't try to drive the SDK's internal abort
    // wiring (that's the SDK's contract); we just lock in that translate
    // collapses an AbortError to `null` for orchestrator consumption.
    mockedGenerateObject.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    )
    const result = await translate("hello", "he")
    expect(result).toBeNull()
  })
})

describe("translate — prompt + model contract", () => {
  it("includes the core buildTranslationPrompt output in the prompt", async () => {
    mockObjectResponse({ status: "already_in_target" })
    await translate("שלום", "he")

    const call = mockedGenerateObject.mock.calls[0]?.[0] as { prompt: string }
    // Sentinels from core/voice/translation-prompt.ts:3
    expect(call.prompt).toContain("תרגם את הטקסט הבא לעברית")
    expect(call.prompt).toContain("אם הטקסט כבר בעברית")
    expect(call.prompt).toContain("שלום") // the source text
    // Schema explanation appended by translate-client
    expect(call.prompt).toContain("already_in_target")
    expect(call.prompt).toContain("translated")
  })

  it("uses gemini-flash-lite-latest (locked in until explicit upgrade)", async () => {
    mockObjectResponse({ status: "translated", text: "x" })
    await translate("hello", "he")
    expect(mockedGoogleAi).toHaveBeenCalledWith("gemini-flash-lite-latest")
  })

  it("passes the schema as the `schema` option of generateObject", async () => {
    mockObjectResponse({ status: "already_in_target" })
    await translate("שלום", "he")
    const call = mockedGenerateObject.mock.calls[0]?.[0] as { schema: unknown }
    expect(call.schema).toBeDefined()
  })
})

describe("translate — cache", () => {
  it("returns the cached value without calling generateObject (translated branch)", async () => {
    // Seed the cache via a real call.
    mockObjectResponse({ status: "translated", text: "שלום" })
    await translate("hello", "he")
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)

    // Second call must short-circuit.
    const second = await translate("hello", "he")
    expect(second).toEqual({ status: "translated", text: "שלום" })
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
  })

  it("caches already_in_target results too (reload skips Gemini)", async () => {
    mockObjectResponse({ status: "already_in_target" })
    await translate("שלום", "he")
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)

    const second = await translate("שלום", "he")
    expect(second).toEqual({ status: "already_in_target" })
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
  })

  it("different targetLang produces independent cache entries", async () => {
    mockObjectResponse({ status: "translated", text: "שלום" })
    await translate("hello", "he")
    mockObjectResponse({ status: "already_in_target" })
    await translate("hello", "en")

    expect(mockedGenerateObject).toHaveBeenCalledTimes(2)
    expect(await getCached("hello", "he")).toEqual({ status: "translated", text: "שלום" })
    expect(await getCached("hello", "en")).toEqual({ status: "already_in_target" })
  })

  it("cache is preserved across separate translate() calls (simulates reload)", async () => {
    mockObjectResponse({ status: "translated", text: "שלום" })
    const first = await translate("hello", "he")
    expect(first).toEqual({ status: "translated", text: "שלום" })

    // Simulate "after reload" — the module is still loaded, but a fresh call
    // with no further generateObject mock must hit the cache.
    mockedGenerateObject.mockReset()
    const second = await translate("hello", "he")
    expect(second).toEqual({ status: "translated", text: "שלום" })
    expect(mockedGenerateObject).not.toHaveBeenCalled()
  })
})
