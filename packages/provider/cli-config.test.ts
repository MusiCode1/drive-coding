import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getCliCommand, getCliSpec } from "./src/config/cli-config"

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

  it("gemini without model → gemini --acp", () => {
    const cmd = getCliCommand("gemini")
    // gemini binary מותקן ישירות (~/.vite-plus/bin/gemini) ומקבל --acp.
    // --experimental-acp הוא deprecated (gemini --help: "use --acp instead").
    expect(cmd.bin).toBe("gemini")
    expect(cmd.args).toContain("--acp")
    expect(cmd.args).not.toContain("--model")
  })

  it("gemini with model → adds --model flag", () => {
    const cmd = getCliCommand("gemini", "gemini-2.5-pro")
    expect(cmd.bin).toBe("gemini")
    expect(cmd.args).toContain("--acp")
    expect(cmd.args).toContain("--model")
    expect(cmd.args).toContain("gemini-2.5-pro")
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

  it("qoder without model → qodercli --acp", () => {
    const cmd = getCliCommand("qoder")
    expect(cmd.bin).toBe("qodercli")
    expect(cmd.args).toContain("--acp")
    expect(cmd.args).not.toContain("--model")
  })

  it("qoder with model → adds --model flag", () => {
    const cmd = getCliCommand("qoder", "some-model")
    expect(cmd.args).toContain("--acp")
    expect(cmd.args).toContain("--model")
    expect(cmd.args).toContain("some-model")
  })

  it('cursor without model → agent acp', () => {
    const cmd = getCliCommand("cursor")
    expect(cmd.bin).toBe("agent")
    expect(cmd.args).toEqual(["acp"])
    expect(cmd.args).not.toContain("--model")
  })

  it('grok without model → grok --no-auto-update agent stdio', () => {
    const cmd = getCliCommand("grok")
    expect(cmd.bin).toBe("grok")
    expect(cmd.args).toEqual(["--no-auto-update", "agent", "stdio"])
    expect(cmd.args).not.toContain("--model")
  })

  it("grok with modelOverride does NOT add --model (supportsModelFlag: false — argv bug, ר' §-1)", () => {
    const cmd = getCliCommand("grok", "grok-4.5")
    expect(cmd.bin).toBe("grok")
    expect(cmd.args).toEqual(["--no-auto-update", "agent", "stdio"])
    expect(cmd.args).not.toContain("--model")
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

// buildStdioToWsArgs was removed in Slice 10 F-1 fix — stdio-to-ws subprocess is gone.
// Direct in-process spawn is used instead. No port wrapping needed.

// ─── getCliCommand + getCliSpec עם override ───────────────────────────────────

describe("getCliCommand with override", () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.CLI_SPECS_FILE
    delete process.env.OPENCODE_BIN
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CLI_SPECS_FILE
    delete process.env.OPENCODE_BIN
  })

  it("1. אין override → getCliCommand(gemini) זהה להיום", async () => {
    // מוודא שאין קובץ override (קובץ לא קיים → {})
    process.env.CLI_SPECS_FILE = "/tmp/no-such-file-cli-specs-99999.jsonc"
    const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
    const result = cmd("gemini")
    expect(result.bin).toBe("gemini")
    expect(result.args).toEqual(["--acp"])
  })

  it("2. override ל-gemini עם args → args דרוסים", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-override-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { args: ["--acp", "--foo"] } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
      const result = cmd("gemini")
      expect(result.args).toEqual(["--acp", "--foo"])
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("3. override ל-gemini עם bin → bin דרוס", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-override-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { bin: "/custom/gemini" } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
      const result = cmd("gemini")
      expect(result.bin).toBe("/custom/gemini")
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("4. override.bin גובר על OPENCODE_BIN", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-override-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ opencode: { bin: "/override/opencode" } }))
    process.env.CLI_SPECS_FILE = filePath
    process.env.OPENCODE_BIN = "/env/opencode"
    try {
      const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
      const result = cmd("opencode")
      // override.bin גובר על OPENCODE_BIN (הקובץ מפורש יותר מ-env כללי)
      expect(result.bin).toBe("/override/opencode")
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("5. getCliSpec(gemini) עם override.unsetEnv → מחזיר spec עם unsetEnv", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-override-test-${Date.now()}.jsonc`)
    const unsetEnvList = ["HTTP_PROXY", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS"]
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { unsetEnv: unsetEnvList } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliSpec: spec } = await import("./src/config/cli-config.js")
      const result = spec("gemini")
      expect(result).toBeDefined()
      expect(result?.unsetEnv).toEqual(unsetEnvList)
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("6. modelOverride + supportsModelFlag עדיין מוסיף --model אחרי args דרוסים", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-override-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { args: ["--acp", "--foo"] } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
      const result = cmd("gemini", "gemini-2.5-pro")
      // args דרוסים + --model בסוף
      expect(result.args).toEqual(["--acp", "--foo", "--model", "gemini-2.5-pro"])
    } finally {
      fs.unlinkSync(filePath)
    }
  })
})
