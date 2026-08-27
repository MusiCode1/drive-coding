/**
 * resize-drag.test.ts — unit-smoke ל-clamp (הפונקציה הטהורה היחידה בקובץ).
 *
 * שאר ה-action (Pointer Events, DOM) מכוסה ידנית ב-Commit 2 (browser).
 *
 * ─── slice connect-panel-resize ───
 */
import { describe, expect, it } from "vitest"
import { clamp, computeDragValue } from "./resize-drag"

describe("clamp", () => {
  it("returns value as-is when within bounds", () => {
    expect(clamp(200, 120, 600)).toBe(200)
  })

  it("clamps to min when below", () => {
    expect(clamp(50, 120, 600)).toBe(120)
  })

  it("clamps to max when above", () => {
    expect(clamp(900, 120, 600)).toBe(600)
  })

  it("handles boundary values exactly", () => {
    expect(clamp(120, 120, 600)).toBe(120)
    expect(clamp(600, 120, 600)).toBe(600)
  })
})

describe("computeDragValue", () => {
  it("y axis: adds vertical delta (default)", () => {
    expect(computeDragValue("y", 100, 150, 200, 120, 600)).toBe(250)
  })

  it("x axis: adds horizontal delta", () => {
    expect(computeDragValue("x", 100, 150, 200, 120, 600)).toBe(250)
  })

  it("x axis with deltaSign -1 subtracts delta", () => {
    expect(computeDragValue("x", 100, 150, 200, 120, 600, -1)).toBe(150)
  })

  it("clamps to min and max", () => {
    expect(computeDragValue("y", 0, 500, 200, 120, 600)).toBe(600)
    expect(computeDragValue("x", 0, -500, 200, 120, 600)).toBe(120)
  })
})
