/**
 * agent-identity.test.ts — unit tests for agent-identity helpers (C0/C1).
 */

import { afterEach, describe, expect, it } from "vitest"
import {
  AGENT_ID_HEADER,
  buildAgentIdentityEnv,
  buildAgentMcpServers,
  DRIVE_CODING_AGENT_ID_ENV,
} from "./agent-identity.js"
import { getSelfBaseUrl, setSelfBaseUrl, setSelfBaseUrlForTests } from "./instances.js"

describe("buildAgentMcpServers", () => {
  it("builds http MCP server with identity header", () => {
    const servers = buildAgentMcpServers("agent-abc", "http://127.0.0.1:4055")
    expect(servers).toEqual([
      {
        type: "http",
        name: "drive-coding",
        url: "http://127.0.0.1:4055/api/mcp",
        headers: [{ name: AGENT_ID_HEADER, value: "agent-abc" }],
      },
    ])
  })

  it("strips trailing slash from base URL", () => {
    const servers = buildAgentMcpServers("x", "http://127.0.0.1:4055/")
    const http = servers[0]
    expect(http && "url" in http && http.url).toBe("http://127.0.0.1:4055/api/mcp")
  })
})

describe("buildAgentIdentityEnv", () => {
  it("maps agent id to DRIVE_CODING_AGENT_ID", () => {
    expect(buildAgentIdentityEnv("uuid-1")).toEqual({ [DRIVE_CODING_AGENT_ID_ENV]: "uuid-1" })
  })
})

describe("getSelfBaseUrl", () => {
  afterEach(() => {
    setSelfBaseUrlForTests(undefined)
  })

  it("throws before listen", () => {
    setSelfBaseUrlForTests(undefined)
    expect(() => getSelfBaseUrl()).toThrow(/not listened/)
  })

  it("returns loopback URL after setSelfBaseUrl", () => {
    setSelfBaseUrl({
      port: 4055,
      host: "0.0.0.0",
      pid: 1,
      version: "0.0.0",
      cwd: "/tmp",
      https: false,
      startedAt: Date.now(),
    })
    expect(getSelfBaseUrl()).toBe("http://127.0.0.1:4055")
  })

  it("uses https scheme when record.https is true", () => {
    setSelfBaseUrl({
      port: 4443,
      host: "::",
      pid: 1,
      version: "0.0.0",
      cwd: "/tmp",
      https: true,
      startedAt: Date.now(),
    })
    expect(getSelfBaseUrl()).toBe("https://127.0.0.1:4443")
  })
})
