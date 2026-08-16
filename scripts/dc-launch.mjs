#!/usr/bin/env node
// scripts/dc-launch.mjs
// Launcher: builds/refreshes the FE if stale, then starts the bin entry.
import { execFileSync, spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

// Delegate to the canonical atomic FE builder. --if-stale rebuilds only when the
// served build's version (build/_app/version.json) differs from HEAD — so a
// `git pull` that updated source no longer leaves a stale bundle served.
const dcBuildFe = path.join(repoRoot, "scripts/dc-build-fe.mjs")
// process.execPath = the current runtime (bun on the server, node on dev) — run the
// sub-script with the same runtime, without requiring `node` to be on PATH.
execFileSync(process.execPath, [dcBuildFe, "--if-stale"], { stdio: "inherit", cwd: repoRoot })

const binEntry = path.join(repoRoot, "packages/backend/src/bin/drive-coding.ts")

// Forward any CLI flags to the bin (e.g. `bun run start -- --https --config app.jsonc`).
// process.argv: [node, dc-launch.mjs, ...userFlags] → slice(2) keeps the user flags.
const forwardedArgs = process.argv.slice(2)

// Intentionally literal "bun" (NOT process.execPath): the BE bin is `#!/usr/bin/env bun`
// and uses `Bun.*` in server.ts → it must always run on bun, regardless of which
// PM/runtime launched this wrapper. Under pnpm/node, process.execPath would crash the BE.
const child = spawn("bun", [binEntry, ...forwardedArgs], {
  stdio: "inherit",
  cwd: repoRoot,
  env: process.env,
})

child.on("exit", (code) => {
  process.exit(code ?? 0)
})
