/**
 * secrets-gate.test.ts — ‏שער-הקבלה של הסלייс `secrets-file`.
 *
 * ‏מנוסח מול הקוד **‏שאחרי** ‏הסלייס ⇒ ‏אדום על ad3c0135, ‏ירוק כשהסלייс הושלם.
 * ‏(‏להבדיל מ-`bug55-probe.test.ts`, ‏שהוא ראיית-בסיס בלבד ‏ומנוסח מול הצורה שלפני.)
 *
 * 🔴 ‏אפס ערכי-סוד אמיתיים — ‏placeholders סינתטיים בלבד.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("node:child_process", () => ({ execFileSync: vi.fn().mockReturnValue("") }))
import { loadConfig } from "../src/config/load-config.js"

const EL = "PLACEHOLDER-EL"
const GM = "PLACEHOLDER-GM"
const tmp: string[] = []
function writeTmp(obj: unknown): string {
  const p = path.join(os.tmpdir(), `secrets-gate-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(p, JSON.stringify(obj))
  tmp.push(p)
  return p
}
afterEach(() => {
  for (const f of tmp) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
  tmp.length = 0
})
// ‏על הבסיס השדות `secrets`/`errors` אינם קיימים — ‏הגישה בטוחה, ‏והשער נופל על הטענה.
const sec = (r: unknown) => (r as { secrets?: Record<string, string> }).secrets ?? {}
const errs = (r: unknown) => (r as { errors?: string[] }).errors ?? []

describe("secrets-gate — #55 ‏לא נולד מחדש", () => {
  it("G1. ‏דגל חלקי + ‏אח בסביבה ⇒ ‏שני הסודות שורדים (config)", () => {
    const r = loadConfig({ argv: { "elevenlabs-key": EL }, env: { GEMINI_API_KEY: GM } })
    expect(sec(r).elevenLabsKey).toBe(EL)
    expect(sec(r).geminiKey).toBe(GM)
  })

  it("G2. ‏אותו מקרה ⇒ ‏שני המפתחות ב-envPatch (‏הכיווניות שנכשלת בשקט)", () => {
    const { envPatch } = loadConfig({ argv: { "elevenlabs-key": EL }, env: { GEMINI_API_KEY: GM } })
    expect(Object.keys(envPatch).sort()).toEqual(["ELEVENLABS_API_KEY", "GEMINI_API_KEY"])
    expect(envPatch["GEMINI_API_KEY"]).toBe(GM)
  })
})

describe("secrets-gate — ‏שכבת secrets.json ‏וקדימות", () => {
  it("G3. ‏קובץ-סודות ⇒ ‏המפתח מגיע ל-envPatch ‏בשם ה-ENV ‏הנכון", () => {
    const p = writeTmp({ elevenLabsKey: EL, geminiKey: GM })
    const { envPatch } = loadConfig({ argv: { secrets: p }, env: {} })
    expect(envPatch["ELEVENLABS_API_KEY"]).toBe(EL)
    expect(envPatch["GEMINI_API_KEY"]).toBe(GM)
  })

  it("G4. ‏קדימות: secrets.json < env < flag", () => {
    const p = writeTmp({ elevenLabsKey: "FROM-FILE", geminiKey: "FROM-FILE" })
    const { envPatch } = loadConfig({
      argv: { secrets: p, "elevenlabs-key": "FROM-FLAG" },
      env: { GEMINI_API_KEY: "FROM-ENV" },
    })
    expect(envPatch["ELEVENLABS_API_KEY"]).toBe("FROM-FLAG")
    expect(envPatch["GEMINI_API_KEY"]).toBe("FROM-ENV")
  })

  it("G5. ‏קובץ-סודות ריק {} ⇒ ‏שקט מוחלט", () => {
    const p = writeTmp({})
    const { envPatch, warnings } = loadConfig({ argv: { secrets: p }, env: {} })
    expect(Object.keys(envPatch)).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe("secrets-gate — ‏שגיאה רועשת", () => {
  it("G6. ‏`voice` ‏בקובץ-הקונפיג ⇒ ‏שגיאה עם שם-המפתח ‏ובלי הערך", () => {
    const p = writeTmp({ port: 4100, voice: { elevenLabsKey: EL } })
    const r = loadConfig({ argv: { config: p }, env: {} })
    const joined = errs(r).join("\n")
    expect(errs(r).length).toBeGreaterThan(0)
    expect(joined).toContain("elevenLabsKey")
    expect(joined).toContain("secrets.json")
    expect(joined).not.toContain(EL) // 🔴 ‏אסור שהערך ידלוף לשגיאה
  })

  it("G7. ‏מפתח-סוד עליון בקובץ-הקונפיג ⇒ ‏אותה שגיאה", () => {
    const p = writeTmp({ geminiKey: GM })
    const r = loadConfig({ argv: { config: p }, env: {} })
    expect(errs(r).join("\n")).toContain("geminiKey")
  })

  it("G8. ‏`--config-json` ‏עם voice ⇒ ‏אותה שגיאה", () => {
    const r = loadConfig({ argv: { "config-json": JSON.stringify({ voice: { geminiKey: GM } }) }, env: {} })
    expect(errs(r).length).toBeGreaterThan(0)
  })

  it("G9. ‏סוד ב-env ‏או בדגל ⇒ ‏**‏אין** ‏שגיאה (§6.2 — ‏הדגלים נשארים)", () => {
    const r1 = loadConfig({ argv: { "gemini-key": GM }, env: {} })
    const r2 = loadConfig({ argv: {}, env: { ELEVENLABS_API_KEY: EL } })
    expect(errs(r1)).toEqual([])
    expect(errs(r2)).toEqual([])
  })
})
