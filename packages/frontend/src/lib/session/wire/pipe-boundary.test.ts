import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url))
const session = "lib/session/"
const wire = `${session}wire/`
const wsFile = `${wire}ws-pipe.ts`
const sseFile = `${wire}sse-pipe.ts`
const rpcFile = `${wire}http-rpc-pipe.ts`
const settingsSocket = "lib/engines/config-change-socket.ts"
const view = `${session}remote-session-view.ts`
const reader = `${wire}frame-reader.ts`
const requiredFiles = [wsFile, sseFile, rpcFile, settingsSocket, view, reader]

function collectProductionFiles(): { path: string; text: string }[] {
  function walk(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        return entry.name.startsWith(".") ||
          entry.name === "__contract__" ||
          entry.name === "__tests__"
          ? []
          : walk(path)
      }
      return /\.(?:ts|svelte|[cm]?js)$/.test(entry.name) && !/\.(?:test|spec|d)\./.test(entry.name)
        ? [path]
        : []
    })
  }

  return walk(sourceRoot).map((path) => ({
    path: relative(sourceRoot, path),
    text: readFileSync(path, "utf8"),
  }))
}

function sources(path: string, text: string): ts.SourceFile[] {
  const parse = (name: string, source: string, kind = ts.ScriptKind.TS) =>
    ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, kind)
  if (!path.endsWith(".svelte")) return [parse(path, text)]

  const scriptTag = /<script\b[^>]*>([\s\S]*?)<\/script>/g
  const component = text.replace(/<!--[\s\S]*?-->/g, "")
  const scripts = [...component.matchAll(scriptTag)].map((match) => parse(path, match[1] ?? ""))
  // Parse the template as JSX to also inspect ordinary inline JS expressions.
  const template = component.replace(scriptTag, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "")
  return [...scripts, parse(path, `const template = <>${template}</>`, ts.ScriptKind.TSX)]
}

function isNamed(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node)) return names.has(node.text)
  if (ts.isPropertyAccessExpression(node)) return isNamed(node.name, names)
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return names.has(node.argumentExpression.text)
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return isNamed(node.expression, names)
  }
  if (ts.isBinaryExpression(node)) return isNamed(node.left, names) || isNamed(node.right, names)
  if (ts.isConditionalExpression(node)) {
    return isNamed(node.whenTrue, names) || isNamed(node.whenFalse, names)
  }
  return false
}

function moduleSpecifier(node: ts.Node): ts.Node | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node.arguments[0]
  }
  return undefined
}

function findViolations(path: string, text: string): string[] {
  const wsAllowed = path === wsFile || path === settingsSocket
  const checkFetch = path.startsWith(session) && path !== sseFile && path !== rpcFile
  const checkImports = path === view || path === reader
  const violations = new Set<string>()
  const socketNames = new Set(["WebSocket", "_WebSocket"])

  for (const source of sources(path, text)) {
    function collectAliases(node: ts.Node): void {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        ((node.initializer && isNamed(node.initializer, socketNames)) ||
          (node.type && ts.isTypeQueryNode(node.type) && isNamed(node.type.exprName, socketNames)))
      ) {
        socketNames.add(node.name.text)
      }
      ts.forEachChild(node, collectAliases)
    }

    function visit(node: ts.Node): void {
      if (!wsAllowed && ts.isNewExpression(node) && isNamed(node.expression, socketNames)) {
        violations.add("WebSocket constructor")
      }
      if (path !== sseFile && ts.isIdentifier(node) && node.text === "readSSEFrames") {
        violations.add("SSE framing")
      }
      if (
        checkFetch &&
        ((ts.isIdentifier(node) && node.text === "fetch") ||
          (ts.isElementAccessExpression(node) &&
            ts.isStringLiteralLike(node.argumentExpression) &&
            node.argumentExpression.text === "fetch"))
      ) {
        violations.add("session fetch")
      }
      const specifier = checkImports ? moduleSpecifier(node) : undefined
      if (
        specifier &&
        ts.isStringLiteralLike(specifier) &&
        /(?:^|\/)(?:[^/]+-pipe|sse-reader)(?:\.[cm]?[jt]s)?$/.test(specifier.text)
      ) {
        violations.add("transport import")
      }
      ts.forEachChild(node, visit)
    }

    if (!wsAllowed) ts.forEachChild(source, collectAliases)
    ts.forEachChild(source, visit)
  }
  return [...violations]
}

describe("session transport boundary (L3)", () => {
  it.each([
    ["lib/other.ts", 'new WebSocket("ws://example.test")', "WebSocket constructor"],
    [
      "lib/other.ts",
      "const Socket = testSocket ?? globalThis.WebSocket; new Socket(url)",
      "WebSocket constructor",
    ],
    [
      "routes/demo/+page.svelte",
      "<script>const socket = new WebSocket(url)</script>",
      "WebSocket constructor",
    ],
    ["lib/session/extra.ts", "readSSEFrames(stream)", "SSE framing"],
    ["lib/session/extra.ts", "const request = globalThis.fetch", "session fetch"],
    ["lib/session/extra.ts", 'window["fetch"](url)', "session fetch"],
    ["lib/session/extra.ts", "fetch(url)", "session fetch"],
    [
      "lib/session/remote-session-view.ts",
      'import { createWsSessionPipe } from "./wire/ws-pipe"',
      "transport import",
    ],
    [
      "lib/session/wire/frame-reader.ts",
      'import type { WireUpdateBatch } from "../sse-reader.js"',
      "transport import",
    ],
  ])("flags %s with %s", (path, source, rule) => {
    expect(findViolations(path, source)).toEqual([rule])
  })

  it("ignores comments, strings and a WebSocket type", () => {
    const path = "lib/session/wire/frame-reader.ts"
    const source = `
      // new WebSocket(url); fetch(url)
      /* readSSEFrames(stream); import "./sse-pipe" */
      const label = "new WebSocket(url)"
      type Constructor = typeof WebSocket
    `
    expect(findViolations(path, source)).toEqual([])
  })

  it("scans real production source and verifies that boundary files are present", () => {
    const source = collectProductionFiles()
    expect(source.length).toBeGreaterThan(0)
    for (const path of requiredFiles) {
      expect(source.find((file) => file.path === path)?.text.trim()).toBeTruthy()
    }
    expect(
      source.flatMap(({ path, text }) =>
        findViolations(path, text).map((rule) => ({ path, rule })),
      ),
    ).toEqual([])
  })
})
