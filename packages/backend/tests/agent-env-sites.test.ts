import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const root = new URL("../../../", import.meta.url)
const directories = [
  "packages/backend/src/acp",
  "packages/backend/src/agents",
  "packages/provider/src",
]

// Search the connector directories in the test so every checkout runs the
// policy check, including systems without ripgrep. Exclude declarations and
// test-only connectors. The count catches a second site in an existing module.
const envSite =
  /\b(?:opts|args)\.(?:agentEnv|shapeEnv)\b|\bhooks\??\.shapeEnv\b|\benv:\s*deps\.env\b|\b(?:startAcpServer|injectEnvOverride|spawn|spawnSync)\(/

function scan(files: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of files.sort()) {
    const sites = readFileSync(new URL(file, root), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !/^(?:\/\/|\/\*|\*)/.test(line) && envSite.test(line))
    if (sites.length > 0) counts[file] = sites.length
  }
  return counts
}

it("pins each production connector site that reads or delivers environment", () => {
  const files = directories.flatMap((dir) =>
    readdirSync(fileURLToPath(new URL(`${dir}/`, root)), { recursive: true, encoding: "utf8" })
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => path.endsWith(".ts") && !/\.(?:test|d)\.ts$|(?:^|\/)live\//.test(path))
      .map((path) => `${dir}/${path}`),
  )
  expect(scan([...files, "packages/backend/src/bin/agent-sidecar.ts"])).toEqual({
    "packages/backend/src/acp/connect-via-sidecar.ts": 1,
    "packages/backend/src/agents/agent-launcher.ts": 5,
    "packages/backend/src/agents/sidecar-backend.ts": 3,
    "packages/backend/src/bin/agent-sidecar.ts": 1,
    "packages/provider/src/connection/codex-acp-startup.ts": 3,
    "packages/provider/src/connection/connect-in-process.ts": 5,
    "packages/provider/src/connection/spawn.ts": 1,
    "packages/provider/src/providers/codex/connect-in-process.ts": 1,
    "packages/provider/src/shared/spawn-core.ts": 4,
    "packages/provider/src/spawn/types.ts": 1,
  })
})
