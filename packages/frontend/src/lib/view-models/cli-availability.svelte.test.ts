/**
 * cli-availability.svelte.test.ts — VM CliAvailability (slice cli-availability, Commit 2).
 *
 * approach: integration (endpoint כבר קיים — Commit 1; VM נבדק מול adapter mocked).
 *
 * בדיקות (§4 Commit 2 + §6 Risks):
 *  - available מאותחל ל-CLI_KINDS המלא (race: לפני שה-load() הראשון מסתיים).
 *  - load() מצליח → available = תוצאת ה-endpoint, loading=false, error=null.
 *  - load() נכשל → fallback ל-CLI_KINDS המלא + error מאוכלס (§2 fallback, DoD #5).
 */
import { CLI_KINDS } from "@drive-coding/core"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("$lib/adapters/cli-availability", () => ({
  fetchCliAvailability: vi.fn(),
}))

import { fetchCliAvailability } from "$lib/adapters/cli-availability"
import { CliAvailability } from "./cli-availability.svelte"

const mockFetch = fetchCliAvailability as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

describe("CliAvailability — race init", () => {
  it("available מאותחל ל-CLI_KINDS המלא לפני load()", () => {
    const vm = new CliAvailability()
    expect(vm.available).toEqual([...CLI_KINDS])
    expect(vm.loading).toBe(true)
  })
})

describe("CliAvailability.load() — success", () => {
  it("ממלא available מתוצאת ה-endpoint, מאפס loading, error נשאר null", async () => {
    mockFetch.mockResolvedValue({
      available: ["opencode", "cursor"],
      details: {},
    })
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.available).toEqual(["opencode", "cursor"])
    expect(vm.loading).toBe(false)
    expect(vm.error).toBeNull()
  })

  it("available ריק מה-endpoint (שום CLI לא מותקן) — לא fallback, זה מצב לגיטימי", async () => {
    mockFetch.mockResolvedValue({ available: [], details: {} })
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.available).toEqual([])
    expect(vm.error).toBeNull()
  })
})

describe("CliAvailability.load() — fallback on failure", () => {
  it("endpoint נכשל → available חוזר ל-CLI_KINDS המלא + error מאוכלס", async () => {
    mockFetch.mockRejectedValue(new Error("/api/cli-availability 500"))
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.available).toEqual([...CLI_KINDS])
    expect(vm.error).toBe("/api/cli-availability 500")
    expect(vm.loading).toBe(false)
  })

  it("שגיאה לא-Error → error מאוכלס כ-String(e), fallback עדיין קורה", async () => {
    mockFetch.mockRejectedValue("boom")
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.error).toBe("boom")
    expect(vm.available).toEqual([...CLI_KINDS])
  })
})
