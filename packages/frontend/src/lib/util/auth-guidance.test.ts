/**
 * auth-guidance.test.ts — TDD: describeAuthMethod pure function.
 * Discriminates ACP AuthMethod (env_var/terminal/agent — agent has NO `type` field,
 * the untagged fallback) into a rendering-friendly shape for AuthGuidance.svelte.
 */

import type { AuthMethod } from "@agentclientprotocol/sdk"
import { describe, expect, it } from "vitest"
import { describeAuthMethod } from "./auth-guidance.js"

describe("describeAuthMethod", () => {
  it("env_var → { kind:'env_var', varNames, link }", () => {
    const method = {
      type: "env_var",
      id: "gemini-api-key",
      name: "Gemini API Key",
      description: "Use a Gemini API key",
      vars: [{ name: "GEMINI_API_KEY" }],
      link: "https://aistudio.google.com/apikey",
    } as AuthMethod

    expect(describeAuthMethod(method)).toEqual({
      kind: "env_var",
      id: "gemini-api-key",
      name: "Gemini API Key",
      description: "Use a Gemini API key",
      varNames: ["GEMINI_API_KEY"],
      link: "https://aistudio.google.com/apikey",
    })
  })

  it("env_var without link → link undefined", () => {
    const method = {
      type: "env_var",
      id: "x",
      name: "X",
      vars: [{ name: "X_KEY" }, { name: "X_SECRET" }],
    } as AuthMethod

    expect(describeAuthMethod(method)).toEqual({
      kind: "env_var",
      id: "x",
      name: "X",
      description: undefined,
      varNames: ["X_KEY", "X_SECRET"],
      link: undefined,
    })
  })

  it("terminal → { kind:'terminal', description as-is }", () => {
    const method = {
      type: "terminal",
      id: "opencode-login",
      name: "opencode login",
      description: "Run `opencode auth login` in the terminal",
    } as AuthMethod

    expect(describeAuthMethod(method)).toEqual({
      kind: "terminal",
      id: "opencode-login",
      name: "opencode login",
      description: "Run `opencode auth login` in the terminal",
    })
  })

  it("agent (no `type` field — untagged fallback) → { kind:'agent', name, description }", () => {
    const method = {
      id: "cursor_login",
      name: "Cursor Login",
      description: "Authenticate via Cursor",
    } as AuthMethod

    expect(describeAuthMethod(method)).toEqual({
      kind: "agent",
      id: "cursor_login",
      name: "Cursor Login",
      description: "Authenticate via Cursor",
    })
  })

  it("gemini's 4 real-world methods all discriminate correctly (live-capture shape)", () => {
    const methods = [
      { id: "oauth-personal", name: "Log in with Google" }, // agent (no type)
      {
        type: "env_var",
        id: "gemini-api-key",
        name: "Gemini API Key",
        vars: [{ name: "GEMINI_API_KEY" }],
      },
      { id: "vertex-ai", name: "Vertex AI" }, // agent
      { id: "gateway", name: "Gateway" }, // agent
    ] as AuthMethod[]

    const described = methods.map(describeAuthMethod)

    expect(described.map((d) => d.kind)).toEqual(["agent", "env_var", "agent", "agent"])
    expect(described.map((d) => d.name)).toEqual([
      "Log in with Google",
      "Gemini API Key",
      "Vertex AI",
      "Gateway",
    ])
  })
})
