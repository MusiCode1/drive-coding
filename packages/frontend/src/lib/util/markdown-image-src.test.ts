// @vitest-environment node
import { describe, expect, it } from "vitest"
import { decideImageSrc } from "./markdown-image-src"

const CWD = "/tmp/p"

describe("decideImageSrc", () => {
  it("empty href → inert", () => {
    expect(decideImageSrc("", CWD)).toEqual({ kind: "inert" })
    expect(decideImageSrc("   ", CWD)).toEqual({ kind: "inert" })
  })

  it("relative with cwd → proxy", () => {
    const d = decideImageSrc("x.png", CWD)
    expect(d.kind).toBe("proxy")
    if (d.kind === "proxy") {
      expect(d.src).toBe(
        `/api/fs/file?uri=${encodeURIComponent("file:///tmp/p/x.png")}`,
      )
    }
  })

  it("relative without cwd → inert", () => {
    expect(decideImageSrc("x.png", null)).toEqual({ kind: "inert" })
  })

  it("./relative with cwd → proxy", () => {
    const d = decideImageSrc("./x.png", CWD)
    expect(d.kind).toBe("proxy")
    if (d.kind === "proxy") {
      expect(d.src).toBe(
        `/api/fs/file?uri=${encodeURIComponent("file:///tmp/p/x.png")}`,
      )
    }
  })

  it("absolute path → proxy", () => {
    const d = decideImageSrc("/tmp/p/x.png", null)
    expect(d.kind).toBe("proxy")
    if (d.kind === "proxy") {
      expect(d.src).toBe(
        `/api/fs/file?uri=${encodeURIComponent("file:///tmp/p/x.png")}`,
      )
    }
  })

  it("file:/// URI → proxy", () => {
    const d = decideImageSrc("file:///tmp/a.png", null)
    expect(d.kind).toBe("proxy")
    if (d.kind === "proxy") {
      expect(d.src).toBe(
        `/api/fs/file?uri=${encodeURIComponent("file:///tmp/a.png")}`,
      )
    }
  })

  it("~/path → inert", () => {
    expect(decideImageSrc("~/x.png", CWD)).toEqual({ kind: "inert" })
  })

  it("data:image/png → data", () => {
    const href = "data:image/png;base64,iVBORw0KGgo="
    expect(decideImageSrc(href, CWD)).toEqual({ kind: "data", src: href })
  })

  it("data:image/svg+xml → data", () => {
    const href = "data:image/svg+xml;base64,PHN2Zz4="
    expect(decideImageSrc(href, CWD)).toEqual({ kind: "data", src: href })
  })

  it("data:text/html → inert", () => {
    expect(decideImageSrc("data:text/html;base64,PHN2Zz4=", CWD)).toEqual({
      kind: "inert",
    })
  })

  it("https:// → remote", () => {
    const url = "https://evil.example/x.png?d=1"
    expect(decideImageSrc(url, CWD)).toEqual({ kind: "remote", url })
  })

  it("http:// → remote", () => {
    const url = "http://example.com/x.png"
    expect(decideImageSrc(url, CWD)).toEqual({ kind: "remote", url })
  })

  it("//host → inert (protocol-relative)", () => {
    expect(decideImageSrc("//evil.example/x.png", CWD)).toEqual({ kind: "inert" })
    expect(decideImageSrc("//evil.example/x.png", null)).toEqual({ kind: "inert" })
  })

  it("javascript: → inert", () => {
    expect(decideImageSrc("javascript:alert(1)", CWD)).toEqual({ kind: "inert" })
  })

  it("JavaScript: → inert (case insensitive scheme)", () => {
    expect(decideImageSrc("JavaScript:alert(1)", CWD)).toEqual({ kind: "inert" })
  })

  it("vbscript: → inert", () => {
    expect(decideImageSrc("vbscript:x.png", CWD)).toEqual({ kind: "inert" })
  })

  it("Windows absolute path C:\\ → inert", () => {
    expect(decideImageSrc("C:\\Users\\x.png", CWD)).toEqual({ kind: "inert" })
  })
})
