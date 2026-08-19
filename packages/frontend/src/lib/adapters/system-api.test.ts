/**
 * system-api.test.ts — integration (mock fetch), עקבי עם agents-api.test.ts.
 * ─── system ─── (slice-be-machine-stats Commit 2)
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@drive-coding/core/async/with-timeout", () => ({
  withTimeout: vi.fn(),
}))

vi.mock("$lib/util/be-url", () => ({
  beUrl: vi.fn((path: string) => `http://localhost:4000${path}`),
  beWsUrl: vi.fn(),
  setBeUrlBase: vi.fn(),
}))

import { withTimeout } from "@drive-coding/core/async/with-timeout"
import { getMachineStats } from "./system-api"

const mockWithTimeout = withTimeout as ReturnType<typeof vi.fn>

const passthroughWithTimeout = async (fn: (signal: AbortSignal) => Promise<unknown>) =>
  fn(new AbortController().signal)

beforeEach(() => {
  vi.resetAllMocks()
})

describe("getMachineStats", () => {
  it("happy path — fetch מחזיר { machine: {...} } → מחזיר את ה-machine", async () => {
    const fakeMachine = {
      totalMemMB: 16384,
      usedMemMB: 12288,
      freeMemMB: 4096,
      memPct: 75,
      loadAvg1: 2.0,
      cpuCount: 8,
      loadPct: 25,
    }
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ machine: fakeMachine }),
      }),
    )

    const result = await getMachineStats()

    expect(result).toEqual(fakeMachine)
    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ label: "getMachineStats" }),
    )
  })

  it("res.ok=false → זורק", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    )

    await expect(getMachineStats()).rejects.toThrow("getMachineStats failed: 503")
  })

  it("machine חסר בתשובה → זורק (הגנה)", async () => {
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    )

    await expect(getMachineStats()).rejects.toThrow(
      "getMachineStats failed: missing machine field",
    )
  })

  it("מקבל signal חיצוני ומעביר אותו ל-withTimeout", async () => {
    const fakeMachine = {
      totalMemMB: 8192,
      usedMemMB: 4096,
      freeMemMB: 4096,
      memPct: 50,
      loadAvg1: 1.0,
      cpuCount: 4,
      loadPct: 25,
    }
    mockWithTimeout.mockImplementation(passthroughWithTimeout)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ machine: fakeMachine }),
      }),
    )

    const ac = new AbortController()
    await getMachineStats(ac.signal)

    expect(mockWithTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
      expect.objectContaining({ signal: ac.signal }),
    )
  })
})
