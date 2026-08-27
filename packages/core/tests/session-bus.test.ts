import { describe, expect, it } from "vitest"
import {
  AgentOpenInput,
  AgentOpenResult,
  AgentSendInput,
  InstanceRecord,
  WaitForTurnEndResult,
} from "../src/schemas/session-bus"

describe("InstanceRecord", () => {
  it("accepts a live registry row", () => {
    const result = InstanceRecord({
      port: 4001,
      host: "127.0.0.1",
      pid: 1094353,
      version: "0.17.0",
      cwd: "/tmp",
      https: false,
      startedAt: 1,
    })
    expect(result).not.toHaveProperty("summary")
  })

  it("rejects a missing port", () => {
    const result = InstanceRecord({
      host: "127.0.0.1",
      pid: 1,
      version: "x",
      cwd: "/",
      https: false,
      startedAt: 1,
    })
    expect(result).toHaveProperty("summary")
  })
})

describe("AgentOpenInput / AgentOpenResult", () => {
  it("accepts the open tool shape", () => {
    const result = AgentOpenInput({ cli: "cursor", cwd: "/tmp", env: { DC_PROBE: "n" } })
    expect(result).not.toHaveProperty("summary")
  })

  it("rejects empty cli", () => {
    const result = AgentOpenInput({ cli: "", cwd: "/tmp" })
    expect(result).toHaveProperty("summary")
  })

  it("accepts the open result shape", () => {
    const result = AgentOpenResult({
      agent: "a1",
      sessionId: "s1",
      url: "http://127.0.0.1:4001/chat/cursor/s1?sessionTransport=http",
    })
    expect(result).not.toHaveProperty("summary")
  })
})

describe("AgentSendInput / WaitForTurnEndResult", () => {
  it("accepts send input", () => {
    const result = AgentSendInput({ agent: "a1", prompt: "hi", timeoutSec: 1800 })
    expect(result).not.toHaveProperty("summary")
  })

  it("accepts wait codes 0, 2, 3, 5", () => {
    for (const code of [0, 2, 3, 5]) {
      const result = WaitForTurnEndResult({ code, why: "x", frames: 1, lastState: "idle" })
      expect(result).not.toHaveProperty("summary")
    }
  })

  it("rejects wait code 4", () => {
    const result = WaitForTurnEndResult({ code: 4, why: "x", frames: 0, lastState: "?" })
    expect(result).toHaveProperty("summary")
  })
})
