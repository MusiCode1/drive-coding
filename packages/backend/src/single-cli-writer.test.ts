import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const srcDir = fileURLToPath(new URL(".", import.meta.url))
const allowedFiles = {
  "wire.write": "agents/sidecar-backend.ts",
  "wire.onLine": "agents/sidecar-backend.ts",
  createFromLineWire: "session-host/session-host.ts",
} as const
type Call = keyof typeof allowedFiles
type Source = { path: string; text: string }

function productionSources(dir: string): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) return productionSources(file)
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) return []
    return [{ path: relative(srcDir, file).split(sep).join("/"), text: readFileSync(file, "utf8") }]
  })
}

function memberName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text
  }
}

function isWire(node: ts.Expression): boolean {
  return ts.isIdentifier(node) ? node.text === "wire" : memberName(node) === "wire"
}

function entryPoints({ path, text }: Source): Set<Call> {
  const found = new Set<Call>()
  // The syntax tree skips comments and does not treat mentions inside strings as calls.
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee) ? callee.text : memberName(callee)
      if (name === "createFromLineWire") found.add(name)
      if (
        (name === "write" || name === "onLine") &&
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        isWire(callee.expression)
      ) {
        found.add(`wire.${name}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest))
  return found
}

function violations(sources: Source[]): string[] {
  return sources.flatMap((source) =>
    [...entryPoints(source)]
      .filter((call) => allowedFiles[call] !== source.path)
      .map((call) => `${source.path}: ${call}`),
  )
}

describe("L6 — backend CLI wire entry points", () => {
  it.each([
    ["conn.wire.write(line)", "wire.write"],
    ["const { wire } = conn; wire.onLine(handler)", "wire.onLine"],
    ["createFromLineWire({ wire })", "createFromLineWire"],
  ])("rejects %s outside the allowed file and ignores commented calls", (text, call) => {
    const path = "delivery/fixture.ts"
    expect(violations([{ path, text }])).toEqual([`${path}: ${call}`])
    expect(violations([{ path, text: `/* ${text} */\nexport const ok = true` }])).toEqual([])
  })

  it("finds each expected entry point and permits it only in its allowed file", () => {
    const sources = productionSources(srcDir)
    for (const [call, path] of Object.entries(allowedFiles)) {
      const source = sources.find((candidate) => candidate.path === path)
      if (!source) throw new Error(`Missing L6 allowlisted file: ${path}`)
      expect(entryPoints(source), path).toContain(call)
    }
    expect(violations(sources)).toEqual([])
  })
})
