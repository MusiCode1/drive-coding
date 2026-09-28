import path from "node:path"
import {
  DOCS_VERSION,
  loadAgentDocs,
  readDocsAsset,
  type AgentDocFile,
} from "@drive-coding/core/docs"
import { resolveAppVersion } from "./app-version.js"
import { resolveDocsSource } from "./docs-source.js"

export type AgentDocIndexEntry = {
  id: string
  title: string
  summary: string
  read_when: string[]
  tags: string[]
  surface: string[]
  stability: string
  docs_version: string
  routes: string[]
  mcp_tools: string[]
  path: string
  headings: string[]
}

type AgentDocsIndex = {
  docsVersion: string
  docs: AgentDocIndexEntry[]
}

type VersionBlock = {
  appVersion: string
  docsVersion: string
  routeCount: number
  generatedAt: string
}

let cachedFiles: readonly AgentDocFile[] | undefined
let cachedGeneratedAt: string | undefined

function bootFiles(): readonly AgentDocFile[] {
  if (cachedFiles === undefined) {
    cachedGeneratedAt = new Date().toISOString()
    cachedFiles = resolveDocsSource()()
  }
  return cachedFiles
}

export function agentDocsGeneratedAt(): string {
  bootFiles()
  return cachedGeneratedAt!
}

export function agentDocFiles(): readonly AgentDocFile[] {
  return bootFiles()
}

export function agentMarkdownDocs(): readonly AgentDocFile[] {
  return loadAgentDocs(() => bootFiles())
}

function parseIndex(): AgentDocsIndex {
  const raw = readDocsAsset(bootFiles(), "index.json")
  if (raw === undefined) {
    return { docsVersion: DOCS_VERSION, docs: [] }
  }
  return JSON.parse(raw) as AgentDocsIndex
}

export function agentDocsIndexEntries(): readonly AgentDocIndexEntry[] {
  return parseIndex().docs
}

function countOpenApiOperations(): number {
  const raw = readDocsAsset(bootFiles(), "openapi.json")
  if (raw === undefined) return 0
  const spec = JSON.parse(raw) as { paths?: Record<string, Record<string, unknown>> }
  return Object.values(spec.paths ?? {}).flatMap((item) =>
    Object.keys(item).filter((k) => !k.startsWith("x-") && k !== "parameters"),
  ).length
}

export function agentDocsVersionBlock(): VersionBlock {
  return {
    appVersion: resolveAppVersion(),
    docsVersion: DOCS_VERSION,
    routeCount: countOpenApiOperations(),
    generatedAt: agentDocsGeneratedAt(),
  }
}

export function buildAgentDocsListBody(): VersionBlock & { docs: AgentDocIndexEntry[] } {
  const index = parseIndex()
  return {
    ...agentDocsVersionBlock(),
    docs: [...index.docs],
  }
}

function indexEntryBasename(entry: AgentDocIndexEntry): string {
  return path.basename(entry.path)
}

export function findMarkdownByDocId(id: string): AgentDocFile | undefined {
  const entry = agentDocsIndexEntries().find((d) => d.id === id)
  if (!entry) return undefined
  const base = indexEntryBasename(entry)
  return agentMarkdownDocs().find((f) => f.name === base)
}

function fieldMatchesQuery(entry: AgentDocIndexEntry, q: string): boolean {
  const needle = q.toLowerCase()
  if (entry.id.toLowerCase().includes(needle)) return true
  if (entry.title.toLowerCase().includes(needle)) return true
  if (entry.summary.toLowerCase().includes(needle)) return true
  for (const line of entry.read_when) {
    if (line.toLowerCase().includes(needle)) return true
  }
  for (const h of entry.headings) {
    if (h.toLowerCase().includes(needle)) return true
  }
  return false
}

export function filterIndexByTags(tags: string[]): AgentDocIndexEntry[] {
  const wanted = new Set(tags)
  return agentDocsIndexEntries().filter((e) => e.tags.some((t) => wanted.has(t)))
}

export function filterIndexByQuery(query: string): AgentDocIndexEntry[] {
  const q = query.trim()
  if (q.length === 0) return []
  return agentDocsIndexEntries().filter((e) => fieldMatchesQuery(e, q))
}

export function buildOpenApiServeBody(): Record<string, unknown> {
  const raw = readDocsAsset(bootFiles(), "openapi.json")
  if (raw === undefined) return {}
  const spec = JSON.parse(raw) as Record<string, unknown>
  return {
    ...spec,
    "x-drive-coding": agentDocsVersionBlock(),
  }
}

export function knownAgentDocIds(): string[] {
  return agentDocsIndexEntries()
    .map((d) => d.id)
    .sort()
}

/** Test hook — reset module cache between cases. */
export function resetAgentDocsRuntimeCacheForTests(): void {
  cachedFiles = undefined
  cachedGeneratedAt = undefined
}
