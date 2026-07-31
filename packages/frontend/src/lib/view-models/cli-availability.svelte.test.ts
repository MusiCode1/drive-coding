/**
 * cli-availability.svelte.test.ts — VM CliAvailability (slice cli-availability, Commit 2;
 * הורחב ל-registry/details ב-slice open-cli-registry-fe, Commit 1).
 *
 * approach: integration (endpoint כבר קיים — Commit 1; VM נבדק מול adapter mocked).
 *
 * בדיקות (§4 Commit 2 + §6 Risks; open-cli-registry-fe §4 Commit 1):
 *  - available מאותחל ל-CLI_KINDS המלא (race: לפני שה-load() הראשון מסתיים).
 *  - registry מאותחל ל-CLI_KINDS המלא (אותו race-guard).
 *  - load() מצליח → available = תוצאת ה-endpoint, loading=false, error=null.
 *  - load() מצליח → registry = Object.keys(details) — כולל kind שאינו ב-CLI_KINDS.
 *  - load() נכשל → fallback ל-CLI_KINDS המלא (available+registry) + error מאוכלס (§2 fallback, DoD #5).
 *
 * ⚠️ ה-mocks במסלול-ההצלחה חייבים details לא-ריק (רשומה לכל kind ב-available), בדיוק
 * כפי שה-BE באמת מחזיר — אחרת registry הנגזר מ-Object.keys(details) יֵצא ריק (בריף §4 C1).
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

  it("registry מאותחל ל-CLI_KINDS המלא לפני load()", () => {
    const vm = new CliAvailability()
    expect(vm.registry).toEqual([...CLI_KINDS])
  })
})

describe("CliAvailability.load() — success", () => {
  it("ממלא available מתוצאת ה-endpoint, מאפס loading, error נשאר null", async () => {
    mockFetch.mockResolvedValue({
      available: ["opencode", "cursor"],
      details: {
        opencode: { found: true, source: "path", displayName: "OpenCode" },
        cursor: { found: true, source: "path" },
        // kind שאינו ב-CLI_KINDS (מהקונפ') — מדמה את הרג'יסטרי האפקטיבי מה-BE
        pi: { found: false, source: "not-found" },
      },
    })
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.available).toEqual(["opencode", "cursor"])
    expect(vm.loading).toBe(false)
    expect(vm.error).toBeNull()
  })

  it("registry = Object.keys(details) — כולל kind שאינו ב-CLI_KINDS", async () => {
    mockFetch.mockResolvedValue({
      available: ["opencode", "cursor"],
      details: {
        opencode: { found: true, source: "path" },
        cursor: { found: true, source: "path" },
        pi: { found: false, source: "not-found" },
      },
    })
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.registry).toEqual(["opencode", "cursor", "pi"])
  })

  it("available ריק מה-endpoint (שום CLI לא מותקן) — לא fallback, זה מצב לגיטימי", async () => {
    const details = Object.fromEntries(
      CLI_KINDS.map((k) => [k, { found: false, source: "not-found" }]),
    )
    mockFetch.mockResolvedValue({ available: [], details })
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.available).toEqual([])
    expect(vm.error).toBeNull()
    expect(vm.registry).toEqual([...CLI_KINDS])
  })
})

describe("CliAvailability.load() — fallback on failure", () => {
  it("endpoint נכשל → available+registry חוזרים ל-CLI_KINDS המלא + error מאוכלס", async () => {
    mockFetch.mockRejectedValue(new Error("/api/cli-availability 500"))
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.available).toEqual([...CLI_KINDS])
    expect(vm.registry).toEqual([...CLI_KINDS])
    expect(vm.error).toBe("/api/cli-availability 500")
    expect(vm.loading).toBe(false)
  })

  it("שגיאה לא-Error → error מאוכלס כ-String(e), fallback עדיין קורה", async () => {
    mockFetch.mockRejectedValue("boom")
    const vm = new CliAvailability()

    await vm.load()

    expect(vm.error).toBe("boom")
    expect(vm.available).toEqual([...CLI_KINDS])
    expect(vm.registry).toEqual([...CLI_KINDS])
  })
})

// ─── ready — נפתר אחרי load() הראשון (slice cli-branding, Commit 1) ───────────
// C3 נשען על זה: routes/+layout.svelte קורא load() פעם אחת, ו-+page.svelte ממתין
// ל-ready במקום לקרוא load() בעצמו.
describe("CliAvailability.ready", () => {
  it("נפתר אחרי load() מוצלח", async () => {
    mockFetch.mockResolvedValue({
      available: ["opencode"],
      details: { opencode: { found: true, source: "path" } },
    })
    const vm = new CliAvailability()

    await vm.load()

    await expect(vm.ready).resolves.toBeUndefined()
  })

  it("נפתר גם כשה-fetch נכשל (finally, לא try) — אין unhandled-rejection", async () => {
    mockFetch.mockRejectedValue(new Error("boom"))
    const vm = new CliAvailability()

    await vm.load()

    await expect(vm.ready).resolves.toBeUndefined()
  })
})
