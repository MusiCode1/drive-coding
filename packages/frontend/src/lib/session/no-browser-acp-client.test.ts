import ts from "typescript"
import { describe, expect, it } from "vitest"
import {
  readProductionSources,
  type SourceFile,
  visitSource,
} from "./source-policy.test-support.js"

const forbiddenModules = new Set([
  "@drive-coding/acp-wire",
  "@drive-coding/acp-wire/browser",
  "@drive-coding/provider/client",
])

function runtimeModule(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    const bindings = clause?.namedBindings
    const onlyTypes =
      clause?.isTypeOnly ||
      (clause?.name === undefined &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly))
    return onlyTypes ? undefined : node.moduleSpecifier
  }
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause
    const onlyTypes =
      node.isTypeOnly ||
      (clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly))
    return onlyTypes ? undefined : node.moduleSpecifier
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node.arguments[0]
  }
  return undefined
}

function runtimeImports(file: SourceFile): string[] {
  const violations = new Set<string>()
  visitSource(file, (node) => {
    const module = runtimeModule(node)
    if (module && ts.isStringLiteralLike(module) && forbiddenModules.has(module.text)) {
      violations.add(module.text)
    }
  })
  return [...violations]
}

describe("no browser ACP client (L4)", () => {
  it.each([
    ['import { connect } from "@drive-coding/acp-wire"', "@drive-coding/acp-wire"],
    ["import '@drive-coding/acp-wire/browser'", "@drive-coding/acp-wire/browser"],
    ['import("@drive-coding/provider/client")', "@drive-coding/provider/client"],
    [
      'export { createAcpClient } from "@drive-coding/provider/client"',
      "@drive-coding/provider/client",
    ],
    ['import { type Client, connect } from "@drive-coding/acp-wire"', "@drive-coding/acp-wire"],
    ['import {} from "@drive-coding/acp-wire"', "@drive-coding/acp-wire"],
  ])("detects a runtime import: %s", (statement, module) => {
    expect(
      runtimeImports({
        path: "lib/Example.svelte",
        text: `<script lang="ts">${statement}</script>`,
      }),
    ).toEqual([module])
  })

  it("allows type imports and ignores comments", () => {
    const text = `
      // import { connect } from "@drive-coding/acp-wire"
      /* import "@drive-coding/acp-wire/browser" */
      import type { AcpTransport } from "@drive-coding/acp-wire/browser"
      import { type PromptBlocks } from "@drive-coding/provider/client"
      export type { AcpTransport as Transport } from "@drive-coding/acp-wire"
      type Client = import("@drive-coding/provider/client").PromptBlocks
    `
    expect(runtimeImports({ path: "lib/other.ts", text })).toEqual([])
  })

  it("scans production sources for forbidden runtime imports", () => {
    const sources = readProductionSources()
    expect(sources.some(({ path }) => path === "lib/session/session-view.ts")).toBe(true)
    expect(
      sources.flatMap((file) =>
        runtimeImports(file).map((module) => ({ path: file.path, module })),
      ),
    ).toEqual([])
  })
})
