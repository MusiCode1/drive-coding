import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

export const PIPE_FILES = [
  "http/events.ts",
  "http/rpc.ts",
  "http/reply.ts",
  "http/presence.ts",
] as const

type Source = { path: string; text: string }

// The syntax tree excludes comments and separates module specifiers from strings in code.
function findViolations(sources: Source[], violates: (node: ts.Node) => boolean): string[] {
  function visit(node: ts.Node): boolean {
    return violates(node) || ts.forEachChild(node, (child) => visit(child) || undefined) === true
  }
  return sources
    .filter(({ path, text }) => visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest)))
    .map(({ path }) => path)
}

function moduleSpecifier(node: ts.Node): ts.Node | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier
  if (ts.isExternalModuleReference(node)) return node.expression
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return node.argument.literal
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === "require")
    ) {
      return node.arguments[0]
    }
  }
}

const pipeDependencies = /^(?:hono(?:\/.*)?|@hono\/.*|ws|node:http)$/

function channelImportViolations(sources: Source[]): string[] {
  return findViolations(sources, (node) => {
    const specifier = moduleSpecifier(node)
    return (
      specifier !== undefined &&
      ts.isStringLiteralLike(specifier) &&
      pipeDependencies.test(specifier.text)
    )
  })
}

const channelMethods = new Set([
  "getOrCreateHost",
  "respondPermission",
  "respondElicitation",
  "touchConnection",
])

function pipeLogicViolations(sources: Source[]): string[] {
  return findViolations(sources, (node) => {
    if (ts.isIdentifier(node) && channelMethods.has(node.text)) return true
    if (!ts.isCallExpression(node)) return false
    const callee = node.expression
    return ts.isPropertyAccessExpression(callee) && callee.name.text === "subscribe"
  })
}

const sessionHostDir = fileURLToPath(new URL("../", import.meta.url))

function channelSources(dir: string): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return channelSources(path)
    if (!/\.[cm]?tsx?$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) return []
    return [{ path: relative(sessionHostDir, path), text: readFileSync(path, "utf8") }]
  })
}

describe("session channel boundary", () => {
  it.each(["hono", "hono/streaming", "@hono/node-server", "ws", "node:http"])(
    "L1 detects an import of %s and skips comments",
    (dependency) => {
      const path = "channel/fixture.ts"
      const text = `import { server } from "${dependency}"`
      for (const source of [
        text,
        `export type Server = import("${dependency}").Server`,
        `const server = import("${dependency}")`,
      ]) {
        expect(channelImportViolations([{ path, text: source }])).toEqual([path])
      }
      expect(
        channelImportViolations([{ path, text: `/* ${text} */\nexport const ok = 1` }]),
      ).toEqual([])
    },
  )

  it.each([
    "registry.getOrCreateHost(id)",
    "broadcaster.subscribe (version)",
    "host.respondPermission(id, result)",
    "host.respondElicitation(id, result)",
    "registry.touchConnection(id, connection)",
  ])("L2 detects %s in pipe code and skips comments", (call) => {
    const path = "http/events.ts"
    expect(pipeLogicViolations([{ path, text: call }])).toEqual([path])
    expect(pipeLogicViolations([{ path, text: `// ${call}\nexport const ok = 1` }])).toEqual([])
  })

  it("L1 keeps production channel modules independent of pipe dependencies", () => {
    const sources = channelSources(join(sessionHostDir, "channel"))
    expect(sources.length).toBeGreaterThanOrEqual(5)
    expect(channelImportViolations(sources)).toEqual([])
  })

  it("L2 keeps all registered pipes free of channel logic", () => {
    const sources = PIPE_FILES.map((path) => ({
      path,
      text: readFileSync(join(sessionHostDir, path), "utf8"),
    }))
    for (const { path, text } of sources) {
      expect(text.trim(), path).not.toBe("")
    }
    expect(pipeLogicViolations(sources)).toEqual([])
  })
})
