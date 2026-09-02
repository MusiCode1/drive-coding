import { describe, expect, it } from "vitest"
import { locationToFileUri } from "./location-to-file-uri"

describe("locationToFileUri", () => {
  it("returns null for extensions outside the proxy allowlist", () => {
    expect(locationToFileUri({ path: "src/server.ts" }, "/home/u/p")).toBeNull()
    expect(locationToFileUri({ path: "index.html" }, "/home/u/p")).toBeNull()
  })

  it("returns null when path has no extension", () => {
    expect(locationToFileUri({ path: "README" }, "/home/u/p")).toBeNull()
  })

  it("resolves absolute allowlisted paths to file:// URIs", () => {
    expect(locationToFileUri({ path: "/tmp/a.png" }, null)).toBe("file:///tmp/a.png")
  })

  it("resolves relative allowlisted paths against cwd", () => {
    expect(locationToFileUri({ path: "docs/plan.md" }, "/home/u/p")).toBe(
      "file:///home/u/p/docs/plan.md",
    )
  })

  it("returns null for relative paths when cwd is missing", () => {
    expect(locationToFileUri({ path: "a.md" }, null)).toBeNull()
  })

  it("passes file:// URIs through unchanged", () => {
    expect(locationToFileUri({ path: "file:///tmp/a.pdf" }, "/home/u/p")).toBe("file:///tmp/a.pdf")
  })

  it("returns null for ~ paths", () => {
    expect(locationToFileUri({ path: "~/notes.md" }, "/home/u/p")).toBeNull()
  })

  it("ignores loc.line — URI has no line fragment", () => {
    const loc = { path: "/tmp/a.md", line: 42 }
    const uri = locationToFileUri(loc, null)
    expect(uri).toBe("file:///tmp/a.md")
    expect(uri).not.toContain(":42")
  })

  it("is case-insensitive on extension", () => {
    expect(locationToFileUri({ path: "/tmp/IMAGE.PNG" }, null)).toBe("file:///tmp/IMAGE.PNG")
  })
})
