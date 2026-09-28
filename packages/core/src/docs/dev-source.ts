import * as fs from "node:fs"
import * as path from "node:path"
import type { AgentDocFile, DocsSource } from "./index.js"

/** Dev path: read `docs/agents/*.md` from disk under `repoRoot`. */
export function createDevDocsSource(repoRoot: string): DocsSource {
  return () => {
    const dir = path.join(repoRoot, "docs", "agents")
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .sort()
      .map(
        (name): AgentDocFile => ({
          name,
          text: fs.readFileSync(path.join(dir, name), "utf8"),
        }),
      )
  }
}
