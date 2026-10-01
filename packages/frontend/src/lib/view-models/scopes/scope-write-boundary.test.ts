import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

type Root = "session" | "transcript" | "cache" | "bubbles" | "bubble" | "map" | "deep" | null
const metadata = new Set([
  "title",
  "titleManual",
  "userNotes",
  "sessionFields",
  "availableCommands",
  "planStore",
  "contextUsage",
  "quota",
  "quotaLoading",
])
const cacheFields = new Set(["sessions", "loading", "error"])
const arrayMutators = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "copyWithin",
  "fill",
])
const mapMutators = new Set(["set", "delete", "clear"])
const assignmentOps = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

function member(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression))
    return node.argumentExpression.text
  return null
}

function ownerClass(node: ts.Node): string | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isClassDeclaration(parent)) return parent.name?.text ?? null
  }
  return null
}

/** Static alias census for the scoped state surfaces. */
function findExternalWrites(source: string, file: string, stats?: { sites: number }): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const aliases = new Map<string, Root>()
  const findings: string[] = []

  function root(node: ts.Node): Root {
    if (ts.isIdentifier(node)) return aliases.get(node.text) ?? null
    if (ts.isParenthesizedExpression(node)) return root(node.expression)
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(tree)
      if (name === "deps.bubbles") return "bubbles"
      if (name === "deps.parents") return "map"
      if (name.endsWith(".session")) return "session"
      return null
    }
    if (ts.isElementAccessExpression(node)) {
      const base = root(node.expression)
      return base === "bubbles" ? "bubble" : base === "deep" ? "deep" : base
    }
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text
      const text = node.getText(tree)
      if (text === "this.#session") return "session"
      if (text === "this.#transcript") return "transcript"
      if (text === "this.#bubbles") return "bubbles"
      if (text === "this.#subagentToolCallParents") return "map"
      if (text === "this.sessionsCache") return "cache"
      if (text === "this.bubbles") return "bubbles"
      if (
        name === "bubbles" &&
        ts.isIdentifier(node.expression) &&
        ["vm", "session"].includes(node.expression.text)
      )
        return "bubbles"
      const base = root(node.expression)
      if (name === "subagentToolCallParents" && base === "session") return "map"
      if (name === "bubbles" && (base === "session" || base === "transcript")) return "bubbles"
      if (name === "sessions" && base === "cache") return "deep"
      if (
        ["segments", "attachments", "contentPlaceholders", "subFrames"].includes(name) &&
        (base === "bubble" || base === "deep")
      )
        return "deep"
      return base === "bubble" ? "bubble" : null
    }
    return null
  }

  function exempt(node: ts.Node, kind: Root): boolean {
    const owner = ownerClass(node)
    return (
      (file.endsWith("session-scoped-state.svelte.ts") &&
        owner === "SessionScope" &&
        (kind === "session" || kind === "map")) ||
      (file.endsWith("transcript-scope.svelte.ts") &&
        owner === "TranscriptScope" &&
        ["transcript", "bubbles", "bubble", "deep"].includes(kind ?? "")) ||
      (file.endsWith("sessions-cache-scope.svelte.ts") &&
        owner === "SessionsCacheScope" &&
        (kind === "cache" || kind === "deep"))
    )
  }

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const kind = root(node.initializer)
      if (kind) aliases.set(node.name.text, kind)
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const base = root(node.initializer)
      const namedSession =
        ts.isIdentifier(node.initializer) && ["vm", "session"].includes(node.initializer.text)
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue
        const field = element.propertyName?.getText(tree) ?? element.name.text
        if (field === "bubbles" && (["session", "transcript"].includes(base ?? "") || namedSession))
          aliases.set(element.name.text, "bubbles")
        if (field === "subagentToolCallParents" && base === "session")
          aliases.set(element.name.text, "map")
      }
    }
    if (ts.isBinaryExpression(node) && assignmentOps.has(node.operatorToken.kind)) {
      const left = node.left
      const base =
        ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)
          ? root(left.expression)
          : root(left)
      const field = member(left)
      const vmFacade = left.getText(tree) === "this.bubbles" && ownerClass(node) === "AgentSession"
      const ownerField =
        (file.endsWith("session-scoped-state.svelte.ts") &&
          ownerClass(node) === "SessionScope" &&
          /^this\.#(?:title|titleManual|userNotes|sessionFields|availableCommands|planStore|contextUsage|quota|quotaLoading|subagentToolCallParents)$/.test(
            left.getText(tree),
          )) ||
        (file.endsWith("transcript-scope.svelte.ts") &&
          ownerClass(node) === "TranscriptScope" &&
          /^this\.#(?:bubbles|displaySnapshot)$/.test(left.getText(tree))) ||
        (file.endsWith("sessions-cache-scope.svelte.ts") &&
          ownerClass(node) === "SessionsCacheScope" &&
          /^this\.#(?:sessions|loading|error)$/.test(left.getText(tree)))
      const vmMetadata =
        ownerClass(node) === "AgentSession" &&
        ts.isPropertyAccessExpression(left) &&
        left.expression.kind === ts.SyntaxKind.ThisKeyword &&
        field !== null &&
        (metadata.has(field) || field === "sessionTitle")
      const helperMetadata =
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === "vm" &&
        field !== null &&
        (metadata.has(field) || field === "sessionTitle")
      const protectedField =
        (base === "session" && field !== null && metadata.has(field)) ||
        (base === "cache" && field !== null && cacheFields.has(field)) ||
        (base === "transcript" && field === "bubbles") ||
        base === "bubbles" ||
        base === "bubble" ||
        base === "deep" ||
        base === "map" ||
        vmMetadata ||
        helperMetadata ||
        vmFacade ||
        ownerField
      if (protectedField && stats) stats.sites += 1
      if (protectedField && !ownerField && !exempt(node, base))
        findings.push(
          `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${node.getText(tree)}`,
        )
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = root(node.expression.expression)
      const method = node.expression.name.text
      const protectedCall =
        (target === "map" && mapMutators.has(method)) ||
        (["bubbles", "bubble", "deep"].includes(target ?? "") && arrayMutators.has(method))
      if (protectedCall && stats) stats.sites += 1
      if (protectedCall && !exempt(node, target)) {
        findings.push(
          `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${node.getText(tree)}`,
        )
      }
      const api = node.expression.getText(tree)
      const apiTarget = node.arguments[0] ? root(node.arguments[0]) : null
      if (
        [
          "Object.assign",
          "Object.defineProperty",
          "Reflect.set",
          "Reflect.deleteProperty",
        ].includes(api) &&
        ["session", "transcript", "cache", "bubbles", "bubble", "map", "deep"].includes(
          apiTarget ?? "",
        ) &&
        !exempt(node, apiTarget)
      ) {
        if (stats) stats.sites += 1
        findings.push(
          `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${node.getText(tree)}`,
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return findings
}

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      return ["__fixtures__", "__tests__"].includes(entry.name) ? [] : productionFiles(path)
    return /\.(?:tsx?|svelte)$/.test(entry.name) && !/\.test\.|\.spec\.|\.d\.ts$/.test(entry.name)
      ? [path]
      : []
  })
}

function scriptSource(path: string): string {
  const source = readFileSync(path, "utf8")
  if (!path.endsWith(".svelte")) return source
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1] ?? "")
    .join("\n")
}

describe("G3 scope write boundary", () => {
  it("has no external writes in production view-models, including Speaker", () => {
    const base = join(import.meta.dirname, "..", "..", "..")
    const files = productionFiles(base)
    const stats = { sites: 0 }
    const findings = files.flatMap((path) =>
      findExternalWrites(scriptSource(path), relative(base, path), stats),
    )
    console.info(
      `G3 census: ${files.length} production TS/Svelte scripts, ${stats.sites} protected write sites, ${findings.length} external writes; speaker=${files.some((path) => path.endsWith("speaker.svelte.ts"))}`,
    )
    expect(findings).toEqual([])
  })

  it.each([
    [
      "setter delegation",
      "class AgentSession { set quota(v: unknown) { this.#session.applyPatch({ kind: 'quota', quota: v }) } f() { this.quota = null } }",
    ],
    [
      "alias and deep bubble",
      "class AgentSession { f() { const list = this.bubbles; list[0].messageId = 'x' } }",
    ],
    [
      "Map alias",
      "class AgentSession { f() { const parents = this.#session.subagentToolCallParents; parents.set('x', 'y') } }",
    ],
    ["Speaker write", "class Speaker { f(i: number) { this.#session.bubbles[i] = {} } }"],
    [
      "original bubble helper",
      "function append(vm: { bubbles: unknown[] }) { vm.bubbles.push({}) }",
    ],
    [
      "original map helper",
      "function append(deps: { parents: () => Map<string, string> }) { deps.parents().set('x', 'y') }",
    ],
    [
      "destructured bubbles",
      "function append(vm: { bubbles: unknown[] }) { const { bubbles } = vm; bubbles.push({}) }",
    ],
    [
      "Object.assign bypass",
      "class AgentSession { f() { Object.assign(this.#session, { quota: null }) } }",
    ],
  ])("rejects %s mutation", (_name, source) => {
    expect(findExternalWrites(source, "mutation.ts").length).toBeGreaterThan(0)
  })
})
