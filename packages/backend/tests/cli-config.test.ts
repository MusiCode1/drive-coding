import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildStdioToWsArgs, getCliCommand } from "../src/acp/cli-config"

describe("getCliCommand", () => {
  const origEnv = process.env.OPENCODE_BIN

  beforeEach(() => {
    process.env.OPENCODE_BIN = undefined
    delete process.env.OPENCODE_BIN
  })

  afterEach(() => {
    if (origEnv === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = origEnv
  })

  it('opencode → { bin: "opencode", args: ["acp"] }', () => {
    const cmd = getCliCommand("opencode")
    expect(cmd.bin).toBe("opencode")
    expect(cmd.args).toEqual(["acp"])
  })

  it("opencode with modelOverride is ignored (no -m / --model)", () => {
    const cmd = getCliCommand("opencode", "anthropic/claude-sonnet-4-5")
    expect(cmd.bin).toBe("opencode")
    expect(cmd.args).toEqual(["acp"])
    // crucial: -m must NOT appear (learning 2026-05-16: opencode acp doesn't accept -m)
    expect(cmd.args).not.toContain("--model")
    expect(cmd.args).not.toContain("-m")
  })

  it("opencode uses OPENCODE_BIN env var if set", () => {
    process.env.OPENCODE_BIN = "/custom/path/opencode"
    const cmd = getCliCommand("opencode")
    expect(cmd.bin).toBe("/custom/path/opencode")
  })

  it("claude without model → npx claude-agent-acp", () => {
    const cmd = getCliCommand("claude")
    expect(cmd.bin).toBe("npx")
    expect(cmd.args.join(" ")).toContain("@agentclientprotocol/claude-agent-acp")
    expect(cmd.args).not.toContain("--model")
  })

  it("claude with model → adds --model flag", () => {
    const cmd = getCliCommand("claude", "claude-sonnet-4-5")
    expect(cmd.args).toContain("--model")
    expect(cmd.args).toContain("claude-sonnet-4-5")
  })

  it("gemini without model → npx gemini-cli --experimental-acp", () => {
    const cmd = getCliCommand("gemini")
    expect(cmd.bin).toBe("npx")
    expect(cmd.args).toContain("--experimental-acp")
    expect(cmd.args.join(" ")).toContain("@google/gemini-cli")
    expect(cmd.args).not.toContain("--model")
  })

  it("gemini with model → adds --model flag", () => {
    const cmd = getCliCommand("gemini", "gemini-2.5-pro")
    expect(cmd.args).toContain("--model")
    expect(cmd.args).toContain("gemini-2.5-pro")
    expect(cmd.args).toContain("--experimental-acp")
  })

  it("codex without model → npx codex-acp", () => {
    const cmd = getCliCommand("codex")
    expect(cmd.bin).toBe("npx")
    expect(cmd.args.join(" ")).toContain("@zed-industries/codex-acp")
  })

  it("codex with model → adds --model flag", () => {
    const cmd = getCliCommand("codex", "gpt-5")
    expect(cmd.args).toContain("--model")
    expect(cmd.args).toContain("gpt-5")
  })

  it("modelOverride trim — empty/whitespace string treated as no model", () => {
    const cmd = getCliCommand("claude", "   ")
    expect(cmd.args).not.toContain("--model")
  })

  it("modelOverride = null treated as no model", () => {
    const cmd = getCliCommand("claude", null)
    expect(cmd.args).not.toContain("--model")
  })
})

describe("buildStdioToWsArgs", () => {
  it("opencode + port=0 → expected args (persist + grace-period -1)", () => {
    const cli = getCliCommand("opencode")
    const args = buildStdioToWsArgs(cli, 0)

    expect(args).toEqual([
      "-y",
      "@rebornix/stdio-to-ws",
      "opencode acp",
      "--port",
      "0",
      "--persist",
      "--grace-period",
      "-1",
    ])
  })

  it("custom port=12345", () => {
    const cli = getCliCommand("opencode")
    const args = buildStdioToWsArgs(cli, 12345)
    expect(args).toContain("--port")
    const portIdx = args.indexOf("--port")
    expect(args[portIdx + 1]).toBe("12345")
  })

  it("port default is 0", () => {
    const cli = getCliCommand("opencode")
    const args = buildStdioToWsArgs(cli)
    const portIdx = args.indexOf("--port")
    expect(args[portIdx + 1]).toBe("0")
  })

  it("CLI command is joined to a single string (stdio-to-ws parses it)", () => {
    const cli = getCliCommand("claude", "model-x")
    const args = buildStdioToWsArgs(cli, 0)
    // Third arg is the joined command — must contain bin + all args
    expect(args[2]).toContain("npx")
    expect(args[2]).toContain("--model")
    expect(args[2]).toContain("model-x")
  })
})
