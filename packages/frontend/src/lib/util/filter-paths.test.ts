import { describe, expect, it } from "vitest"
import { filterPaths, type PathEntry } from "./filter-paths"

/** Deliberately non-alphabetical — catches accidental .sort() in filterPaths. */
const FIXTURE: PathEntry[] = [
  { cwd: "/home/user/z-last" },
  { cwd: "/home/user/m-mid" },
  { cwd: "/home/user/a-first" },
  { cwd: "/home/user/projects/drive-coding/dev" },
  { cwd: "/var/tmp/DRIVE-coding-UPPER" },
]

function manyProjects(n: number): PathEntry[] {
  return Array.from({ length: n }, (_, i) => ({ cwd: `/proj/${String(i).padStart(3, "0")}` }))
}

describe("filterPaths", () => {
  it("empty query applies limit", () => {
    expect(filterPaths(manyProjects(116), "", 20)).toHaveLength(20)
  })

  it("non-empty query has no limit", () => {
    const all = manyProjects(116).map((p) => ({
      cwd: `${p.cwd}/drive-coding`,
    }))
    expect(filterPaths(all, "drive-coding", 20).length).toBeGreaterThan(20)
  })

  it("matches case-insensitively on full cwd", () => {
    const hits = filterPaths(FIXTURE, "DRIVE", 20).map((p) => p.cwd)
    expect(hits).toContain("/home/user/projects/drive-coding/dev")
    expect(hits).toContain("/var/tmp/DRIVE-coding-UPPER")
  })

  it("preserves input order (no sort)", () => {
    expect(filterPaths(FIXTURE, "", 20).map((p) => p.cwd)).toEqual(FIXTURE.map((p) => p.cwd))
  })
})
