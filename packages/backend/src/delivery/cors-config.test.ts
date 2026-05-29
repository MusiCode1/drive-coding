import { describe, expect, it } from "vitest"
import { parseCorsOrigins } from "./cors-config"

describe("parseCorsOrigins", () => {
  it("defaults to the current localhost origin when unset", () => {
    expect(parseCorsOrigins(undefined)).toEqual(["http://localhost:5173"])
  })

  it("defaults to the current localhost origin when blank", () => {
    expect(parseCorsOrigins("   ")).toEqual(["http://localhost:5173"])
  })

  it("accepts wildcard", () => {
    expect(parseCorsOrigins("*")).toBe("*")
  })

  it("parses comma-separated origins", () => {
    expect(parseCorsOrigins("http://localhost:5173,https://voice-acp.example.com")).toEqual([
      "http://localhost:5173",
      "https://voice-acp.example.com",
    ])
  })

  it("trims whitespace and strips trailing slashes", () => {
    expect(parseCorsOrigins(" https://voice-acp.example.com/ , http://localhost:5173/ ")).toEqual([
      "https://voice-acp.example.com",
      "http://localhost:5173",
    ])
  })

  it("returns a string for a single configured origin", () => {
    expect(parseCorsOrigins("https://voice-acp.example.com")).toBe("https://voice-acp.example.com")
  })

  it("rejects entries without http or https scheme", () => {
    expect(() => parseCorsOrigins("voice-acp.example.com")).toThrow(/not a valid URL/)
    expect(() => parseCorsOrigins("ws://voice-acp.example.com")).toThrow(/scheme/)
  })

  it("rejects origins that include paths", () => {
    expect(() => parseCorsOrigins("https://voice-acp.example.com/api")).toThrow(
      /must not include path/,
    )
  })
})
