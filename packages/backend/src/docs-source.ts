import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { createDevDocsSource, type AgentDocFile, type DocsSource } from "@drive-coding/core/docs"
import { isBinary } from "./binary.js"
import { AGENT_DOCS } from "./docs-content.gen.js"

const DEV_REPO_CANDIDATES = [
  path.resolve(import.meta.dirname, "../../.."),
  path.resolve(import.meta.dirname, "../../../.."),
]

const NPM_DOCS_CANDIDATES = [
  path.resolve(import.meta.dirname, "../docs-agents"),
  path.resolve(import.meta.dirname, "../../docs-agents"),
]

function readDirAsFiles(dir: string): readonly AgentDocFile[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .map((name): AgentDocFile => {
      const text = readFileSync(path.join(dir, name), "utf8")
      return { name, text }
    })
}

export function createNpmDocsSource(dir: string): DocsSource {
  return () => readDirAsFiles(dir)
}

export function createBinaryDocsSource(): DocsSource {
  return () =>
    Object.entries(AGENT_DOCS)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, text]) => ({ name, text }))
}

function resolveDevRepoRoot(): string {
  const hit = DEV_REPO_CANDIDATES.find((root) =>
    existsSync(path.join(root, "docs", "agents", "index.json")),
  )
  return hit ?? DEV_REPO_CANDIDATES[0]!
}

function resolveNpmDocsDir(): string | undefined {
  return NPM_DOCS_CANDIDATES.find((dir) => existsSync(path.join(dir, "index.json")))
}

/** Precedence: binary → npm bundle → dev disk (brief §2). */
export function resolveDocsSource(): DocsSource {
  if (isBinary()) return createBinaryDocsSource()
  const npmDir = resolveNpmDocsDir()
  if (npmDir !== undefined) return createNpmDocsSource(npmDir)
  return createDevDocsSource(resolveDevRepoRoot())
}
