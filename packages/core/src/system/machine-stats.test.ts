/**
 * machine-stats — TDD tests (Commit 0)
 *
 * מתמטיקה טהורה: נגזרות RAM/CPU מ-RawMachineSample. אין node:os, אין IO.
 * ─── system ─── (slice-be-machine-stats Commit 0)
 */
import { describe, it, expect } from "vitest"
import { deriveMachineStats } from "./machine-stats.js"

const MB = 1024 * 1024

describe("deriveMachineStats", () => {
  it("happy path: 16GB total / 4GB free / load 2.0 / 8 cpus", () => {
    const result = deriveMachineStats({
      totalMemBytes: 16 * 1024 * MB,
      freeMemBytes: 4 * 1024 * MB,
      loadAvg1: 2.0,
      cpuCount: 8,
    })
    expect(result.totalMemMB).toBe(16 * 1024)
    expect(result.usedMemMB).toBe(12 * 1024)
    expect(result.freeMemMB).toBe(4 * 1024)
    expect(result.memPct).toBe(75)
    expect(result.loadAvg1).toBe(2.0)
    expect(result.cpuCount).toBe(8)
    expect(result.loadPct).toBe(25)
  })

  it("division-by-zero: totalMemBytes=0 → memPct=0 (not NaN/Infinity)", () => {
    const result = deriveMachineStats({
      totalMemBytes: 0,
      freeMemBytes: 0,
      loadAvg1: 1.0,
      cpuCount: 4,
    })
    expect(result.memPct).toBe(0)
    expect(Number.isFinite(result.memPct)).toBe(true)
  })

  it("cpuCount=0 → treated as 1, loadPct not NaN", () => {
    const result = deriveMachineStats({
      totalMemBytes: 8 * 1024 * MB,
      freeMemBytes: 4 * 1024 * MB,
      loadAvg1: 0.5,
      cpuCount: 0,
    })
    expect(result.cpuCount).toBe(1)
    expect(result.loadPct).toBe(50)
    expect(Number.isFinite(result.loadPct)).toBe(true)
  })

  it("clamp: load 20 on 8 cpus → loadPct=100 (not >100)", () => {
    const result = deriveMachineStats({
      totalMemBytes: 8 * 1024 * MB,
      freeMemBytes: 4 * 1024 * MB,
      loadAvg1: 20,
      cpuCount: 8,
    })
    expect(result.loadPct).toBe(100)
  })

  it("rounding: memPct is an integer, loadAvg1 rounded to 1 decimal", () => {
    const result = deriveMachineStats({
      totalMemBytes: 10 * 1024 * MB,
      freeMemBytes: 3 * 1024 * MB,
      loadAvg1: 1.234,
      cpuCount: 4,
    })
    expect(Number.isInteger(result.memPct)).toBe(true)
    expect(result.memPct).toBe(70) // 7/10 * 100 = 70
    expect(result.loadAvg1).toBe(1.2)
  })
})
