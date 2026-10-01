import * as fs from "node:fs"
import * as path from "node:path"
import type { AgentDocFile, DocsSource } from "./index.js"

/** Dev path: read `docs/agents/*.md` from disk under `repoRoot`. */
export function createDevDocsSource(repoRoot: string): DocsSource {
  return () => {
    const dir = path.join(repoRoot, "docs", "agents")
    if (!fs.existsSync(dir)) return []
    const allowed = (n: string) =>
      n.endsWith(".md") || n === "index.json" || n === "openapi.json" || n === "tags.json"
    return fs
      .readdirSync(dir)
      .filter(allowed)
      .sort()
      .map(
        (name): AgentDocFile => ({
          name,
          text: fs.readFileSync(path.join(dir, name), "utf8"),
        }),
      )
  }
}
