import { describe, expect, it } from "vitest"
import { parsePortFromStdout } from "../src/acp/bridge-spawn"

describe("parsePortFromStdout", () => {
  it("parses ws:// URL", () => {
    expect(parsePortFromStdout("Listening on ws://127.0.0.1:7100/")).toBe(7100)
  })

  it("parses ws://localhost", () => {
    expect(parsePortFromStdout("ws://localhost:7100")).toBe(7100)
  })

  it("parses 'listening on port'", () => {
    expect(parsePortFromStdout("Server listening on port 7100")).toBe(7100)
  })

  it("parses 'port X'", () => {
    expect(parsePortFromStdout("running on port 7100")).toBe(7100)
  })

  it("returns null for unrelated", () => {
    expect(parsePortFromStdout("starting up...")).toBeNull()
    expect(parsePortFromStdout("")).toBeNull()
    expect(parsePortFromStdout("warning: deprecated flag")).toBeNull()
  })

  it("handles multiple ports — returns first ws://", () => {
    expect(parsePortFromStdout("ws://127.0.0.1:7100/ alt port 9999")).toBe(7100)
  })
})
