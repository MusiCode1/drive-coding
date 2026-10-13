/**
 * settings-scope-policy.test.ts — reactive VM (C3).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("../adapters/scope-policy-api.js", () => ({
  fetchScopePolicy: vi.fn(),
  patchScopePolicy: vi.fn(),
}))

import { fetchScopePolicy, patchScopePolicy } from "../adapters/scope-policy-api.js"
import { SettingsScopePolicy } from "./settings-scope-policy.svelte.js"

const mockFetch = fetchScopePolicy as ReturnType<typeof vi.fn>
const mockPatch = patchScopePolicy as ReturnType<typeof vi.fn>

const snap = {
  policies: { message: "ask", update: "ask", close: "ask" },
  sources: { message: "default", update: "default", close: "default" },
} as const

beforeEach(() => {
  vi.resetAllMocks()
})

describe("SettingsScopePolicy", () => {
  it("refresh stores confirmed snapshot from GET", async () => {
    mockFetch.mockResolvedValue(snap)
    const vm = new SettingsScopePolicy(() => "")
    await vm.refresh()
    expect(vm.confirmed).toEqual(snap)
    expect(vm.error).toBeNull()
  })

  it("GET failure clears confirmed and sets error", async () => {
    mockFetch.mockRejectedValue(new Error("network"))
    const vm = new SettingsScopePolicy(() => "")
    await vm.refresh()
    expect(vm.confirmed).toBeNull()
    expect(vm.error).toMatch(/network/)
  })

  it("stale GET after beUrl generation bump on same URL does not apply", async () => {
    const url = "http://localhost:4000"
    let call = 0
    mockFetch.mockImplementation(async () => {
      call += 1
      const myCall = call
      await new Promise((r) => setTimeout(r, 30))
      return {
        ...snap,
        policies: {
          ...snap.policies,
          message: myCall === 1 ? ("allow" as const) : ("deny" as const),
        },
      }
    })
    const vm = new SettingsScopePolicy(() => url)
    const slow = vm.refresh()
    vm.noteBeUrlChanged()
    await vm.refresh()
    await slow
    expect(vm.confirmed?.policies.message).toBe("deny")
  })

  it("noteBeUrlChanged clears saving and ignores late PATCH finally", async () => {
    mockFetch.mockResolvedValue(snap)
    mockPatch.mockImplementation(
      () => new Promise((r) => setTimeout(() => r(snap), 50)),
    )
    const vm = new SettingsScopePolicy(() => "http://localhost:4000")
    await vm.refresh()
    const patchP = vm.setPolicy("message", "allow")
    expect(vm.saving).toBe(true)
    vm.noteBeUrlChanged()
    expect(vm.saving).toBe(false)
    await patchP
    expect(vm.confirmed).toBeNull()
  })

  it("PATCH failure restores previous confirmed and bumps readbackEpoch", async () => {
    mockFetch.mockResolvedValue(snap)
    mockPatch.mockRejectedValue(new Error("500"))
    const vm = new SettingsScopePolicy(() => "")
    await vm.refresh()
    const epochBefore = vm.readbackEpoch
    await vm.setPolicy("message", "allow")
    expect(vm.confirmed).toEqual(snap)
    expect(vm.error).toMatch(/500/)
    expect(vm.readbackEpoch).toBeGreaterThan(epochBefore)
    expect(vm.saving).toBe(false)
  })
})
