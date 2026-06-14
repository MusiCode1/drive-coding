/**
 * map-acp-capabilities.test.ts — mapAcpCapabilities (P1b/Commit 3).
 *
 * ⚠️ המקור הוא AcpClient.capabilities (= SDK AgentCapabilities), לא ports.ts
 * AcpCapabilities (DoD #8). resume/list נגזרים מ-caps; permissions/tools=true תמיד.
 */
import type { AgentCapabilities } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "vitest"
import { mapAcpCapabilities } from "../../src/provider/acp-provider.js"

describe("mapAcpCapabilities", () => {
  test("undefined → permissions/tools=true, השאר false", () => {
    expect(mapAcpCapabilities(undefined)).toEqual({
      resume: false,
      list: false,
      delete: false,
      close: false,
      permissions: true,
      images: false,
      tools: true,
      diff: false,
      revert: false,
      fs: false,
      terminal: false,
      mcpExternal: false,
      mcpEmbedded: false,
    })
  })

  test("loadSession:true → resume:true", () => {
    expect(mapAcpCapabilities({ loadSession: true } as AgentCapabilities).resume).toBe(true)
  })

  test("sessionCapabilities.resume נוכח → resume:true", () => {
    const caps = { sessionCapabilities: { resume: {} } } as unknown as AgentCapabilities
    expect(mapAcpCapabilities(caps).resume).toBe(true)
  })

  test("sessionCapabilities.list נוכח → list:true", () => {
    const caps = { sessionCapabilities: { list: {} } } as unknown as AgentCapabilities
    expect(mapAcpCapabilities(caps).list).toBe(true)
  })

  test("sessionCapabilities.close נוכח → close:true; delete תמיד false", () => {
    const caps = { sessionCapabilities: { close: {} } } as unknown as AgentCapabilities
    const out = mapAcpCapabilities(caps)
    expect(out.close).toBe(true)
    expect(out.delete).toBe(false)
  })

  test("promptCapabilities.image:true → images:true", () => {
    const caps = {
      promptCapabilities: { image: true, audio: false, embeddedContext: false },
    } as AgentCapabilities
    expect(mapAcpCapabilities(caps).images).toBe(true)
  })

  test("mcpCapabilities נוכח → mcpExternal:true", () => {
    const caps = { mcpCapabilities: {} } as AgentCapabilities
    expect(mapAcpCapabilities(caps).mcpExternal).toBe(true)
  })

  test("permissions/tools=true גם כשה-caps ריקים", () => {
    const out = mapAcpCapabilities({} as AgentCapabilities)
    expect(out.permissions).toBe(true)
    expect(out.tools).toBe(true)
  })
})
