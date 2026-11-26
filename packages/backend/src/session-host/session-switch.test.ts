import { readFileSync } from "node:fs"
import { createInitialSessionState } from "@drive-coding/core/session"
import ts from "typescript"
import { expect, it, vi } from "vitest"
import { createSessionSwitch } from "./session-switch.js"

it("session-switch imports core and protocol types only", () => {
  const source = readFileSync(new URL("./session-switch.ts", import.meta.url), "utf8")
  const file = ts.createSourceFile("session-switch.ts", source, ts.ScriptTarget.Latest)
  const matchesPackage = (name: string, pkg: string) => name === pkg || name.startsWith(`${pkg}/`)
  const imports = file.statements.filter(ts.isImportDeclaration)
  expect(imports.length).toBeGreaterThan(0)

  for (const declaration of imports) {
    const specifier = declaration.moduleSpecifier
    if (!ts.isStringLiteral(specifier)) throw new Error("Expected a literal import specifier")
    const name = specifier.text
    const allowed =
      matchesPackage(name, "@drive-coding/core") ||
      (declaration.importClause?.isTypeOnly === true &&
        (matchesPackage(name, "@drive-coding/provider") ||
          matchesPackage(name, "@agentclientprotocol/sdk")))
    expect(allowed, name).toBe(true)
  }
})

it("keeps the pre-flip guard active until every overlapping switch has left it", () => {
  const turnLifecycle = { turnSeq: 0, cancelledTurn: 0 }
  const bumpQuotaGeneration = vi.fn()
  const sessionSwitch = createSessionSwitch({
    state: createInitialSessionState({ sessionId: "A" }),
    turnLifecycle,
    bumpQuotaGeneration,
    permPending: { respond: vi.fn() },
    elicitPending: { respond: vi.fn() },
    emitPatches: vi.fn(),
  })

  expect(sessionSwitch.isPreFlip).toBe(false)
  sessionSwitch.beginPreFlip()
  sessionSwitch.beginPreFlip()
  expect(turnLifecycle).toEqual({ turnSeq: 2, cancelledTurn: -1 })
  expect(bumpQuotaGeneration).toHaveBeenCalledTimes(2)
  sessionSwitch.endPreFlip()
  expect(sessionSwitch.isPreFlip).toBe(true)
  sessionSwitch.endPreFlip()
  expect(sessionSwitch.isPreFlip).toBe(false)
})
