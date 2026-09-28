export const DOCS_VERSION = "1.0.0"

export type AgentDocFile = { readonly name: string; readonly text: string }
/** Document source. **Synchronous on purpose** — async IO belongs in dev-source.ts. */
export type DocsSource = () => readonly AgentDocFile[]

/**
 * Single entry with declared precedence. Stage 0 implements **dev only**:
 *   1. dev      — createDevDocsSource(repoRoot)              ← implemented
 *   2. npm      — release/docs-agents/ (build.mjs step 3)     ← stage 3
 *   3. binary   — docs-content.gen.ts (build-binary.mjs)     ← stage 3
 * The last two are declared here and not implemented in this slice.
 */
export function loadAgentDocs(source: DocsSource): readonly AgentDocFile[] {
  return source().filter((f) => f.name.endsWith(".md") && f.name !== "index.md")
}

export { createDevDocsSource } from "./dev-source.js"
