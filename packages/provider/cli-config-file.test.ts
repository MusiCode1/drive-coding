/**
 * cli-config-file.test.ts — בדיקות TDD ל-loadCliSpecsOverride / resolveCliSpecsPath.
 *
 * Covers:
 *  1. קובץ לא קיים → {} בלי throw
 *  2. JSONC תקין עם הערות → נפענח נכון
 *  3. JSON שבור → {} + warning
 *  4. CLI_SPECS_FILE env דורס את ברירת-המחדל
 *  5. שדה לא תקין (args שהוא string) → השדה מדולג, השאר נשמר
 *  6. CLI חדש (מפתח שלא ב-CLI_SPECS) → נשמר במפה
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── ייבוא מעוכב — נייבא בתוך כל טסט כדי שה-memoization יאופס בין ריצות ──
// מאחר ש-loadCliSpecsOverride מנוהל ב-memoization ברמת המודול,
// נייבא מחדש בכל טסט (resetModules בין בדיקות).

describe("resolveCliSpecsPath", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    // שחזור env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  it("ברירת-מחדל: ~/.config/drive-coding/cli-specs.jsonc", async () => {
    delete process.env.CLI_SPECS_FILE
    const { resolveCliSpecsPath } = await import("./src/config/cli-config-file.js")
    const result = resolveCliSpecsPath()
    const expected = path.join(os.homedir(), ".config", "drive-coding", "cli-specs.jsonc")
    expect(result).toBe(expected)
  })

  it("CLI_SPECS_FILE env דורס את ברירת-המחדל", async () => {
    process.env.CLI_SPECS_FILE = "/tmp/custom-cli-specs.jsonc"
    const { resolveCliSpecsPath } = await import("./src/config/cli-config-file.js")
    const result = resolveCliSpecsPath({ CLI_SPECS_FILE: "/tmp/custom-cli-specs.jsonc" })
    expect(result).toBe("/tmp/custom-cli-specs.jsonc")
  })
})

describe("loadCliSpecsOverride", () => {
  const tmpFiles: string[] = []
  const originalEnv = { ...process.env }

  function writeTmpFile(content: string, name?: string): string {
    const filePath =
      name ??
      path.join(
        os.tmpdir(),
        `cli-specs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonc`,
      )
    fs.writeFileSync(filePath, content, "utf8")
    tmpFiles.push(filePath)
    return filePath
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    // ניקוי קבצים זמניים
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f)
      } catch {
        // התעלם
      }
    }
    tmpFiles.length = 0
    // שחזור env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  it("1. קובץ לא קיים → {} בלי throw ובלי warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const nonExistent = "/tmp/does-not-exist-cli-specs-12345.jsonc"
    process.env.CLI_SPECS_FILE = nonExistent

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result).toEqual({})
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("2. JSONC תקין עם הערות → נפענח נכון", async () => {
    const content = `{
  // נקה proxy/CA של OneCLI מ-gemini
  "gemini": {
    "unsetEnv": ["HTTP_PROXY", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS"]
    /* הערת בלוק */
  }
}`
    const filePath = writeTmpFile(content)
    process.env.CLI_SPECS_FILE = filePath

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result).toHaveProperty("gemini")
    expect(result["gemini"]).toEqual({
      unsetEnv: ["HTTP_PROXY", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS"],
    })
  })

  it("3. JSON שבור → {} + warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const filePath = writeTmpFile("{ this is not valid json }")
    process.env.CLI_SPECS_FILE = filePath

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result).toEqual({})
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("4. שדה לא תקין (args שהוא string במקום array) → השדה מדולג, השאר נשמר", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const content = JSON.stringify({
      gemini: {
        bin: "/custom/gemini",
        args: "this-is-not-an-array", // לא תקין
        unsetEnv: ["HTTP_PROXY"],
      },
    })
    const filePath = writeTmpFile(content)
    process.env.CLI_SPECS_FILE = filePath

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["gemini"]).toBeDefined()
    // bin ו-unsetEnv נשמרו, args נדלג
    expect(result["gemini"]?.bin).toBe("/custom/gemini")
    expect(result["gemini"]?.unsetEnv).toEqual(["HTTP_PROXY"])
    expect(result["gemini"]?.args).toBeUndefined()
    warnSpy.mockRestore()
  })

  it("5. CLI חדש (מפתח שלא ב-CLI_SPECS) → נשמר במפה", async () => {
    const content = JSON.stringify({
      mycli: {
        bin: "/usr/local/bin/mycli",
        args: ["--acp"],
        supportsModelFlag: true,
      },
    })
    const filePath = writeTmpFile(content)
    process.env.CLI_SPECS_FILE = filePath

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["mycli"]).toBeDefined()
    expect(result["mycli"]?.bin).toBe("/usr/local/bin/mycli")
    expect(result["mycli"]?.args).toEqual(["--acp"])
    expect(result["mycli"]?.supportsModelFlag).toBe(true)
  })

  it("6. CLI_SPECS_FILE env דורס את ברירת-המחדל", async () => {
    const content = JSON.stringify({ opencode: { bin: "/custom/opencode" } })
    const filePath = writeTmpFile(content)
    process.env.CLI_SPECS_FILE = filePath

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["opencode"]?.bin).toBe("/custom/opencode")
  })

  // --- CLI_SPECS_JSON (open-cli-registry C0) ---

  it("7. CLI_SPECS_JSON בלבד → מיושם כ-override", async () => {
    process.env.CLI_SPECS_JSON = JSON.stringify({ claude: { bin: "/inline/claude" } })
    process.env.CLI_SPECS_FILE = "/tmp/does-not-exist-specs-99999.jsonc"

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["claude"]?.bin).toBe("/inline/claude")
  })

  it("8. קובץ בלבד (רגרסיה — בלי CLI_SPECS_JSON)", async () => {
    const content = JSON.stringify({ gemini: { bin: "/file/gemini" } })
    const filePath = writeTmpFile(content)
    process.env.CLI_SPECS_FILE = filePath
    delete process.env.CLI_SPECS_JSON

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["gemini"]?.bin).toBe("/file/gemini")
  })

  it("9. שניהם → CLI_SPECS_JSON גובר per-key, שאר הקובץ נשאר", async () => {
    const fileContent = JSON.stringify({
      opencode: { bin: "/file/opencode" },
      gemini: { bin: "/file/gemini" },
    })
    const filePath = writeTmpFile(fileContent)
    process.env.CLI_SPECS_FILE = filePath
    process.env.CLI_SPECS_JSON = JSON.stringify({ opencode: { bin: "/inline/opencode" } })

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["opencode"]?.bin).toBe("/inline/opencode")
    expect(result["gemini"]?.bin).toBe("/file/gemini")
  })

  it("10. CLI_SPECS_JSON שבור → {} + warning, בלי לזרוק (הקובץ עדיין חל)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fileContent = JSON.stringify({ opencode: { bin: "/file/opencode" } })
    const filePath = writeTmpFile(fileContent)
    process.env.CLI_SPECS_FILE = filePath
    process.env.CLI_SPECS_JSON = "{ not valid json }"

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["opencode"]?.bin).toBe("/file/opencode")
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("11. $schema key in file → ignored, no warning, not treated as CLI kind", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const content = JSON.stringify({
      $schema: "https://drive-coding.dev/schemas/cli-specs.schema.json",
      opencode: { bin: "/custom/opencode" },
    })
    const filePath = writeTmpFile(content)
    process.env.CLI_SPECS_FILE = filePath
    delete process.env.CLI_SPECS_JSON

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["$schema"]).toBeUndefined()
    expect(result["opencode"]?.bin).toBe("/custom/opencode")
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("12. $schema key in CLI_SPECS_JSON → ignored, no warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.CLI_SPECS_JSON = JSON.stringify({
      $schema: "https://drive-coding.dev/schemas/cli-specs.schema.json",
      claude: { bin: "/inline/claude" },
    })
    process.env.CLI_SPECS_FILE = "/tmp/does-not-exist-specs-88888.jsonc"

    const { loadCliSpecsOverride } = await import("./src/config/cli-config-file.js")
    const result = loadCliSpecsOverride()

    expect(result["$schema"]).toBeUndefined()
    expect(result["claude"]?.bin).toBe("/inline/claude")
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
