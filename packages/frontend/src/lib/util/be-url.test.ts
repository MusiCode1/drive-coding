import { beforeEach, describe, expect, it, vi } from "vitest"
import { _resetForTests, beUrl, beWsUrl, setBeUrlBase } from "./be-url"

describe("be-url", () => {
  beforeEach(() => {
    _resetForTests()
    vi.stubGlobal("location", {
      origin: "http://localhost:5173",
      protocol: "http:",
      host: "localhost:5173",
    })
  })

  it("empty base → uses location.origin", () => {
    expect(beUrl("/api/agents")).toBe("http://localhost:5173/api/agents")
  })

  it("set base → uses base", () => {
    setBeUrlBase("https://be.example.com")
    expect(beUrl("/api/agents")).toBe("https://be.example.com/api/agents")
  })

  it("strips trailing slash from base", () => {
    setBeUrlBase("https://be.example.com/")
    expect(beUrl("/api/agents")).toBe("https://be.example.com/api/agents")
  })

  it("normalizes path without leading slash", () => {
    expect(beUrl("api/agents")).toBe("http://localhost:5173/api/agents")
  })

  it("beWsUrl empty base → ws://", () => {
    expect(beWsUrl("/ws/agent/abc")).toBe("ws://localhost:5173/ws/agent/abc")
  })

  it("beWsUrl https base → wss://", () => {
    setBeUrlBase("https://be.example.com")
    expect(beWsUrl("/ws/agent/abc")).toBe("wss://be.example.com/ws/agent/abc")
  })

  it("beWsUrl http base → ws://", () => {
    setBeUrlBase("http://localhost:4002")
    expect(beWsUrl("/ws/agent/abc")).toBe("ws://localhost:4002/ws/agent/abc")
  })

  it("beWsUrl normalizes path without leading slash", () => {
    setBeUrlBase("http://localhost:4002")
    expect(beWsUrl("ws/agent/abc")).toBe("ws://localhost:4002/ws/agent/abc")
  })

  it("SSR safe — beUrl without location returns path as-is", () => {
    vi.unstubAllGlobals()
    expect(beUrl("/api/x")).toBe("/api/x")
  })

  it("SSR safe — beWsUrl without location returns stub", () => {
    vi.unstubAllGlobals()
    expect(beWsUrl("/ws/x")).toBe("ws://ssr-stub/ws/x")
  })
})
