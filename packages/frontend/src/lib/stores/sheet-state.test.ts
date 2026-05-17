/**
 * sheet-state.test.ts — Phase 3 TDD
 *
 * Tests for the BottomSheet open/close state singleton.
 */
import { afterEach, describe, expect, it } from "vitest"
import { sheetState } from "./sheet-state.svelte"

describe("sheetState", () => {
  afterEach(() => {
    // Reset to closed after each test
    sheetState.close()
  })

  it("starts closed", () => {
    expect(sheetState.isOpen).toBe(false)
  })

  it("open() sets isOpen to true", () => {
    sheetState.open()
    expect(sheetState.isOpen).toBe(true)
  })

  it("close() sets isOpen to false", () => {
    sheetState.open()
    sheetState.close()
    expect(sheetState.isOpen).toBe(false)
  })

  it("toggle() flips state", () => {
    expect(sheetState.isOpen).toBe(false)
    sheetState.toggle()
    expect(sheetState.isOpen).toBe(true)
    sheetState.toggle()
    expect(sheetState.isOpen).toBe(false)
  })
})
