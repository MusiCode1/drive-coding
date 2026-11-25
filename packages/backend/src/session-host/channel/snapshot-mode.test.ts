import { describe, expect, it } from "vitest"
import { parseSnapshotMode } from "./snapshot-mode"

describe("parseSnapshotMode", () => {
  it("defaults missing or empty to full", () => {
    expect(parseSnapshotMode(undefined)).toBe("full")
    expect(parseSnapshotMode("")).toBe("full")
  })

  it("accepts full and meta", () => {
    expect(parseSnapshotMode("full")).toBe("full")
    expect(parseSnapshotMode("meta")).toBe("meta")
  })

  it("rejects unknown values", () => {
    expect(parseSnapshotMode("bogus")).toBe("invalid")
    expect(parseSnapshotMode("META")).toBe("invalid")
  })
})