/**
 * resize-plan — TDD tests (Commit 0)
 *
 * מתמטיקה טהורה: חישוב scale-to-fit ל-image, ללא browser globals.
 * ─── image ─── (slice-image-paste Commit 0)
 */
import { describe, it, expect } from "vitest"
import { planResize } from "./resize-plan.js"

describe("planResize", () => {
  // תמונה קטנה מתחת לכל הסיפים — no-op
  it("small image below all thresholds → shouldReencode:false, unchanged dims", () => {
    const result = planResize({
      width: 800,
      height: 600,
      bytes: 500_000, // 500KB
      mimeType: "image/jpeg",
    })
    expect(result.shouldReencode).toBe(false)
    expect(result.targetWidth).toBe(800)
    expect(result.targetHeight).toBe(600)
  })

  // רוחב > maxDim → scale כך שהרוחב = maxDim
  it("wide image (4096x2048) → scales to 2048 wide, height proportional", () => {
    const result = planResize({
      width: 4096,
      height: 2048,
      bytes: 1_000_000,
      mimeType: "image/png",
    })
    expect(result.shouldReencode).toBe(true)
    expect(result.targetWidth).toBe(2048)
    expect(result.targetHeight).toBe(1024)
  })

  // גובה > רוחב, גובה הוא המימד הגדול
  it("tall image (1024x4000) → tall dimension clamped to maxDim=2048", () => {
    const result = planResize({
      width: 1024,
      height: 4000,
      bytes: 1_000_000,
      mimeType: "image/png",
    })
    expect(result.shouldReencode).toBe(true)
    expect(result.targetHeight).toBe(2048)
    // יחס: 1024/4000 * 2048 = 524.288 → 524
    expect(result.targetWidth).toBe(524)
  })

  // bytes > maxBytes אך מימדים קטנים → shouldReencode:true (כיווץ איכות)
  it("small dims but bytes > maxBytes → shouldReencode:true", () => {
    const result = planResize({
      width: 800,
      height: 600,
      bytes: 10 * 1024 * 1024, // 10MB
      mimeType: "image/png",
    })
    expect(result.shouldReencode).toBe(true)
    expect(result.targetWidth).toBe(800)
    expect(result.targetHeight).toBe(600)
  })

  // JPEG קטן → no-op
  it("small jpeg below all thresholds → shouldReencode:false", () => {
    const result = planResize({
      width: 640,
      height: 480,
      bytes: 200_000,
      mimeType: "image/jpeg",
    })
    expect(result.shouldReencode).toBe(false)
    expect(result.targetWidth).toBe(640)
    expect(result.targetHeight).toBe(480)
  })

  // מימדים מעוגלים ל-int
  it("rounds dimensions to integers", () => {
    // 3000x2000 → scale by 2048/3000 ≈ 0.6826... → height = 2000*0.6826... = 1365.3...
    const result = planResize({
      width: 3000,
      height: 2000,
      bytes: 1_000_000,
      mimeType: "image/png",
    })
    expect(result.shouldReencode).toBe(true)
    expect(result.targetWidth).toBe(2048)
    expect(Number.isInteger(result.targetHeight)).toBe(true)
    expect(result.targetHeight).toBe(Math.round(2000 * (2048 / 3000)))
  })

  // default limits יכולים להיות overridden
  it("respects custom maxDim", () => {
    const result = planResize(
      { width: 2000, height: 1000, bytes: 100_000, mimeType: "image/jpeg" },
      { maxDim: 1000 }
    )
    expect(result.shouldReencode).toBe(true)
    expect(result.targetWidth).toBe(1000)
    expect(result.targetHeight).toBe(500)
  })

  it("respects custom maxBytes", () => {
    const result = planResize(
      { width: 100, height: 100, bytes: 200_000, mimeType: "image/jpeg" },
      { maxBytes: 100_000 }
    )
    expect(result.shouldReencode).toBe(true)
    expect(result.targetWidth).toBe(100)
    expect(result.targetHeight).toBe(100)
  })
})
