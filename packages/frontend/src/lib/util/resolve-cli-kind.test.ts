import { describe, expect, it } from "vitest"
import { resolveCliKind } from "./resolve-cli-kind"

describe("resolveCliKind", () => {
  it("cliKind מיושן (לא ברג'יסטרי) → נופל לערך תקף מותקן", () => {
    const result = resolveCliKind("removed-cli", ["opencode", "codex"], ["codex"])
    expect(result).toBe("codex")
  })

  it("cliKind תקף וברג'יסטרי → לא זז", () => {
    const result = resolveCliKind("codex", ["opencode", "codex"], ["opencode"])
    expect(result).toBe("codex")
  })

  it("registry ריק → לא קורס, נופל ל-opencode", () => {
    const result = resolveCliKind("removed-cli", [], [])
    expect(result).toBe("opencode")
  })

  it("cliKind מיושן ואין אף אחד available → נופל לראשון ברג'יסטרי", () => {
    const result = resolveCliKind("removed-cli", ["pi", "cline"], [])
    expect(result).toBe("pi")
  })

  // slice open-cli-registry-fe, Commit 5: handleRecentSelect (+page.svelte) מזין
  // project.kind ישירות — ריק כש-recent-projects.ts:47 לא קיבל kind מה-BE, או
  // מחרוזת שהוסרה מהקונפ'. שני המקרים חייבים לנפול לתקף בדיוק כמו onMount.
  it("cliKind ריק (recent-project ללא kind שמור) → נופל לראשון ברג'יסטרי שמותקן", () => {
    const result = resolveCliKind("", ["opencode", "codex"], ["codex"])
    expect(result).toBe("codex")
  })

  it("cliKind של recent-project שאינו ברג'יסטרי → נופל לתקף (לא נשאר ריק חזותית)", () => {
    const result = resolveCliKind("ghost-cli-removed", ["opencode", "codex"], ["opencode"])
    expect(result).toBe("opencode")
  })
})
