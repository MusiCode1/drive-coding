/**
 * ui-shell.svelte.test.ts — UiShellVM inputMode (slice playback-dock-scope, Commit 0).
 */
import { describe, expect, it } from "vitest"
import { UiShellVM } from "./ui-shell.svelte"

describe("UiShellVM — inputMode", () => {
  it("defaults to record", () => {
    const vm = new UiShellVM()
    expect(vm.inputMode).toBe("record")
  })

  it("setInputMode replaces the value", () => {
    const vm = new UiShellVM()
    vm.setInputMode("typing")
    expect(vm.inputMode).toBe("typing")
    vm.setInputMode("hidden")
    expect(vm.inputMode).toBe("hidden")
  })

  it("does not affect other shell fields", () => {
    const vm = new UiShellVM()
    vm.sidebarCollapsed = true
    vm.sheetDetent = "half"
    vm.sheetDragPx = 120
    vm.setInputMode("typing")
    expect(vm.sidebarCollapsed).toBe(true)
    expect(vm.sheetDetent).toBe("half")
    expect(vm.sheetDragPx).toBe(120)
  })

  it("resetInputModeForSession restores record from typing", () => {
    const vm = new UiShellVM()
    vm.setInputMode("typing")
    vm.resetInputModeForSession()
    expect(vm.inputMode).toBe("record")
  })

  it("resetInputModeForSession restores record from hidden", () => {
    const vm = new UiShellVM()
    vm.setInputMode("hidden")
    vm.resetInputModeForSession()
    expect(vm.inputMode).toBe("record")
  })
})
