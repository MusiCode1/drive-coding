import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseComponent } from "svelte/compiler"
import ts from "typescript"

export type SourceFile = { path: string; text: string }

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url))

export function readProductionSources(): SourceFile[] {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.name.startsWith(".") || entry.name.startsWith("__")) return []
      if (entry.isDirectory()) return walk(path)
      return /\.(?:[cm]?[jt]s|svelte)$/.test(entry.name) &&
        !/\.(?:test(?:-support)?|spec|d)\./.test(entry.name)
        ? [path]
        : []
    })
  }

  return walk(sourceRoot).map((path) => ({
    path: relative(sourceRoot, path),
    text: readFileSync(path, "utf8"),
  }))
}

function hasSourceRange(node: unknown): node is { start: number; end: number } {
  return (
    node !== null &&
    typeof node === "object" &&
    "start" in node &&
    "end" in node &&
    typeof node.start === "number" &&
    typeof node.end === "number"
  )
}

export function visitSource({ path, text }: SourceFile, visit: (node: ts.Node) => void): void {
  const parse = (code: string) =>
    ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  function walk(node: ts.Node): void {
    visit(node)
    ts.forEachChild(node, walk)
  }

  if (!path.endsWith(".svelte")) {
    walk(parse(text))
    return
  }

  const component = parseComponent(text, { modern: true })
  for (const script of [component.instance, component.module]) {
    if (script) {
      const { content } = script
      if (!hasSourceRange(content)) throw new Error(`Missing script source range: ${path}`)
      walk(parse(text.slice(content.start, content.end)))
    }
  }

  function walkTemplate(node: unknown): void {
    if (Array.isArray(node)) {
      for (const child of node) walkTemplate(child)
      return
    }
    if (!node || typeof node !== "object") return
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if ((key === "expression" || key === "test" || key === "key") && hasSourceRange(child)) {
        walk(parse(`(${text.slice(child.start, child.end)})`))
      } else {
        walkTemplate(child)
      }
    }
  }
  walkTemplate(component.fragment)
}
