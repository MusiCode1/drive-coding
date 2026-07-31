import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getCliCommand, getCliSpec } from "./src/config/cli-config"

describe("getCliCommand", () => {
  const origEnv = process.env.OPENCODE_BIN
  const origCliSpecsFile = process.env.CLI_SPECS_FILE

  beforeEach(() => {
    process.env.OPENCODE_BIN = undefined
    delete process.env.OPENCODE_BIN
    vi.resetModules()
    // בידוד מקובץ-הקונפ' האמיתי של המשתמש (~/.config/drive-coding/cli-specs.jsonc) —
    // הצבה מפורשת לנתיב לא-קיים, לא delete (delete נופל בחזרה ל-homedir(), שזה ההפך
    // מבידוד — ר' cli-config-file.ts:29 ותיעוד ב-describe הבא).
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE"
  })

  afterEach(() => {
    if (origEnv === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = origEnv
    if (origCliSpecsFile === undefined) delete process.env.CLI_SPECS_FILE
    else process.env.CLI_SPECS_FILE = origCliSpecsFile
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

// ─── הרג'יסטרי האפקטיבי — CliId (slice open-cli-registry, Commit 2) ───────────
// כל טסט כאן קורא קובץ-קונפ' (ישיר או דרך CLI_SPECS), ולכן חייב בידוד מלא:
// vi.resetModules() + הצבת CLI_SPECS_FILE + import() דינמי בתוך הטסט.

describe("registry אפקטיבי (getEffectiveCliKinds/Specs + getCliCommand על CLI מהקונפ')", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE"
    delete process.env.OPENCODE_BIN
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CLI_SPECS_FILE
    delete process.env.OPENCODE_BIN
  })

  it("1. getCliCommand('mycli') מקונפ' → ה-bin/args שלה", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-registry-test-${Date.now()}.jsonc`)
    fs.writeFileSync(
      filePath,
      JSON.stringify({ mycli: { bin: "opencode", args: ["acp"], supportsModelFlag: false } }),
    )
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
      const result = cmd("mycli")
      expect(result.bin).toBe("opencode")
      expect(result.args).toEqual(["acp"])
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("2. getCliCommand('nope') → זורק (לא קיים בשום מקום)", async () => {
    const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
    expect(() => cmd("nope")).toThrow("Unknown cliKind: nope")
  })

  it("3. getEffectiveCliKinds() בלי קונפ' = CLI_KINDS", async () => {
    const { getEffectiveCliKinds } = await import("./src/config/cli-config.js")
    const { CLI_KINDS } = await import("@drive-coding/core")
    expect(getEffectiveCliKinds()).toEqual([...CLI_KINDS])
  })

  it("4. getEffectiveCliKinds() עם קונפ' → כולל את ה-CLI החדש", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-registry-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ mycli: { bin: "opencode", args: ["acp"] } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getEffectiveCliKinds } = await import("./src/config/cli-config.js")
      const kinds = getEffectiveCliKinds()
      expect(kinds).toContain("mycli")
      expect(kinds).toContain("opencode")
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("5. רגרסיה: 7 המובנים מחזירים אותו {bin,args} בלי קונפ'", async () => {
    const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
    expect(cmd("opencode")).toEqual({ bin: "opencode", args: ["acp"] })
    expect(cmd("cursor")).toEqual({ bin: "agent", args: ["acp"] })
    expect(cmd("grok")).toEqual({ bin: "grok", args: ["--no-auto-update", "agent", "stdio"] })
    expect(cmd("qoder")).toEqual({ bin: "qodercli", args: ["--acp"] })
  })

  it("6. override.supportsModelFlag על CLI מובנה נכנס לתוקף", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-registry-test-${Date.now()}.jsonc`)
    // cursor: supportsModelFlag=false ב-CLI_SPECS. override הופך אותו ל-true.
    fs.writeFileSync(filePath, JSON.stringify({ cursor: { supportsModelFlag: true } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliCommand: cmd } = await import("./src/config/cli-config.js")
      const result = cmd("cursor", "some-model")
      expect(result.args).toContain("--model")
      expect(result.args).toContain("some-model")
    } finally {
      fs.unlinkSync(filePath)
    }
  })
})

// ─── displayName + logo (slice cli-branding, Commit 0) ───────────────────────
// ארבע התחנות: CliSpec → MutableOverride → validateOverride → getCliSpec spread.
// שדה שעובר 3/4 נעלם בשקט (envVar/detectBin הם הבאג החי) — לכן הטסטים כאן בודקים
// ישירות את getCliSpec, לא רק את loadCliSpecsOverride.
describe("getCliSpec — displayName + logo (Commit 0, cli-branding)", () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.OPENCODE_BIN
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CLI_SPECS_FILE
    delete process.env.OPENCODE_BIN
  })

  it("1. displayName מהקונפ' מגיע ל-getCliSpec", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-branding-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { displayName: "Gemini" } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliSpec } = await import("./src/config/cli-config.js")
      const result = getCliSpec("gemini")
      expect(result?.displayName).toBe("Gemini")
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("2. חסר displayName → undefined", async () => {
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE"
    const { getCliSpec } = await import("./src/config/cli-config.js")
    const result = getCliSpec("gemini")
    expect(result?.displayName).toBeUndefined()
  })

  it("3. displayName לא-string → warn + מדולג", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-branding-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { displayName: 123 } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliSpec } = await import("./src/config/cli-config.js")
      const result = getCliSpec("gemini")
      expect(result?.displayName).toBeUndefined()
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      fs.unlinkSync(filePath)
      warnSpy.mockRestore()
    }
  })

  it("4. logo מהקונפ' מגיע ל-getCliSpec", async () => {
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-branding-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { logo: "/tmp/gemini.png" } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliSpec } = await import("./src/config/cli-config.js")
      const result = getCliSpec("gemini")
      expect(result?.logo).toBe("/tmp/gemini.png")
    } finally {
      fs.unlinkSync(filePath)
    }
  })

  it("5. חסר logo → undefined", async () => {
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE"
    const { getCliSpec } = await import("./src/config/cli-config.js")
    const result = getCliSpec("gemini")
    expect(result?.logo).toBeUndefined()
  })

  it("6. logo לא-string → warn + מדולג", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fs = await import("node:fs")
    const os = await import("node:os")
    const path = await import("node:path")
    const filePath = path.join(os.tmpdir(), `cli-branding-test-${Date.now()}.jsonc`)
    fs.writeFileSync(filePath, JSON.stringify({ gemini: { logo: 42 } }))
    process.env.CLI_SPECS_FILE = filePath
    try {
      const { getCliSpec } = await import("./src/config/cli-config.js")
      const result = getCliSpec("gemini")
      expect(result?.logo).toBeUndefined()
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      fs.unlinkSync(filePath)
      warnSpy.mockRestore()
    }
  })

  it("7. רגרסיה: 7 המובנים ללא שינוי (בלי displayName/logo)", async () => {
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE"
    const { getCliCommand } = await import("./src/config/cli-config.js")
    expect(getCliCommand("opencode")).toEqual({ bin: "opencode", args: ["acp"] })
    expect(getCliCommand("cursor")).toEqual({ bin: "agent", args: ["acp"] })
    expect(getCliCommand("grok")).toEqual({ bin: "grok", args: ["--no-auto-update", "agent", "stdio"] })
    expect(getCliCommand("qoder")).toEqual({ bin: "qodercli", args: ["--acp"] })
  })
})
