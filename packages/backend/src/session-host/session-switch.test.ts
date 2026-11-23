import { readFileSync } from "node:fs"
import ts from "typescript"
import { expect, it } from "vitest"

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
